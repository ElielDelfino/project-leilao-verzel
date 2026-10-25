// Caso de uso "aceitar lance" (specs/007 §Comportamento; ADR 0031 D5, D6, D10, D11, D12). Antes da
// transação: papel, validação, limite e 404. Uma transação READ COMMITTED: travarLote, agora(tx)
// uma vez, idempotência, recusas, anexar, travarCarteiras, comprometer, liberar, registrarLance.
// Eventos só depois do COMMIT (aposCommit). Outros módulos só pelos index.ts, na mesma `tx`.
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { SchemasApi } from '@leilao/contracts';
import { sql } from 'drizzle-orm';
import type { z } from 'zod';

import type { UsuarioDaSessao } from '../../common/auth/sessao.js';
import { ErroApi } from '../../common/erros/erro-api.js';
import { type ColetorDeEventos, aposCommit } from '../../common/eventos/apos-commit.js';
import { PublicadorDeEventos } from '../../common/eventos/publicador-de-eventos.js';
import { LimiteDeTentativas, REGRA_DO_LANCE } from '../../common/limite/limite-de-tentativas.js';
import { PipeZod } from '../../common/validacao/pipe-zod.js';
import { BANCO } from '../../config/banco.module.js';
import type { Banco, Transacao } from '../../db/banco.js';
import {
  comprometer,
  ErroDeCarteira,
  liberar,
  type ReferenciaDoLance,
  type SaldoComDisponivel,
  travarCarteiras,
} from '../carteira/index.js';
import {
  agora,
  type LoteTravado,
  obterResumos,
  registrarLance,
  travarLote,
} from '../lotes/index.js';
import { CadeiaDeLances, type LanceAnexado } from './cadeia.js';
import { esquemaDaChaveDoLance, esquemaDoLance, UUID_DO_LOTE } from './esquemas.js';
import {
  dadosInvalidos,
  eventosDoLance,
  fimDepoisDoLance,
  type LancePublico,
  recusaDoLance,
  traduzirFalhaDoLance,
  traduzirRecusaDeSaldo,
} from './regras.js';
import { buscarLancePorChave, type LanceDaChave } from './repositorio.js';

/** Entrada crua da rota: validada aqui, depois do papel (specs/007 §Ordem das verificações). */
export interface PedidoDeLance {
  readonly loteId: string;
  readonly corpo: unknown;
  readonly chave: unknown;
}

export interface ResultadoDoLance {
  /** true → 201 (lance novo); false → 200 (repetição idempotente). */
  readonly criado: boolean;
  readonly dados: SchemasApi['RespostaLance']['dados'];
}

interface LanceValidado {
  readonly usuarioId: string;
  readonly loteId: string;
  readonly valorCentavos: number;
  readonly chave: string;
}

interface LiderAnterior {
  readonly liderId: string;
  readonly lanceId: string;
  readonly valorCentavos: number;
}

function loteNaoEncontrado(): ErroApi {
  return new ErroApi({
    codigo: 'NAO_ENCONTRADO',
    status: HttpStatus.NOT_FOUND,
    mensagem: 'Recurso não encontrado.',
  });
}

function validar<E extends z.ZodType>(esquema: E, valor: unknown): z.output<E> {
  return new PipeZod(esquema).transform(valor);
}

function lancePublico(
  lance: Pick<LanceDaChave, 'seq' | 'pseudonimo' | 'valorCentavos'>,
  criadoEm: string,
): LancePublico {
  return {
    seq: lance.seq,
    pseudonimo: lance.pseudonimo,
    valorCentavos: lance.valorCentavos,
    criadoEm,
  };
}

/** Repetição da chave (ADR 0031 D5): mesmo lote e valor → o lance original e o lote de agora. */
function repeticao(
  repetido: LanceDaChave,
  lote: LoteTravado,
  pedido: LanceValidado,
): ResultadoDoLance {
  if (repetido.loteId !== pedido.loteId || repetido.valorCentavos !== pedido.valorCentavos) {
    throw dadosInvalidos();
  }
  if (lote.lanceAtualCentavos === null) throw new Error('lote com lance gravado sem lance atual');
  return {
    criado: false,
    dados: {
      lance: lancePublico(repetido, repetido.criadoEm.toISOString()),
      lote: {
        lanceAtualCentavos: lote.lanceAtualCentavos,
        fimEm: lote.fimEm.toISOString(),
        totalLances: lote.totalLances,
      },
    },
  };
}

/**
 * Líder anterior a liberar, ou `null` no primeiro lance. Confere a cadeia contra o lote travado:
 * divergência (seq fora de `total_lances + 1`, líder sem lance anterior) é bug e aborta a `tx`.
 */
function liderAnterior(lote: LoteTravado, anexado: LanceAnexado): LiderAnterior | null {
  if (anexado.seq !== lote.totalLances + 1) throw new Error('cadeia e lote divergem no seq');
  if (lote.liderId === null) {
    if (anexado.lanceAnteriorId !== null) throw new Error('lance anterior sem líder no lote');
    return null;
  }
  if (anexado.lanceAnteriorId === null || lote.lanceAtualCentavos === null) {
    throw new Error('líder no lote sem lance anterior na cadeia');
  }
  return {
    liderId: lote.liderId,
    lanceId: anexado.lanceAnteriorId,
    valorCentavos: lote.lanceAtualCentavos,
  };
}

/** `comprometer` do licitante; a recusa de saldo vira 422 e é sempre relançada (rollback). */
async function comprometerOuRecusar(
  tx: Transacao,
  usuarioId: string,
  valorCentavos: number,
  referencia: ReferenciaDoLance,
): Promise<SaldoComDisponivel> {
  try {
    return await comprometer(tx, usuarioId, valorCentavos, referencia);
  } catch (erro: unknown) {
    throw traduzirRecusaDeSaldo(erro);
  }
}

@Injectable()
export class ServicoDeLances {
  readonly #logger = new Logger('Lances');

  constructor(
    @Inject(BANCO) private readonly banco: Banco,
    @Inject(LimiteDeTentativas) private readonly limite: LimiteDeTentativas,
    @Inject(PublicadorDeEventos) private readonly publicador: PublicadorDeEventos,
    @Inject(CadeiaDeLances) private readonly cadeia: CadeiaDeLances,
  ) {}

  async aceitar(sessao: UsuarioDaSessao, pedido: PedidoDeLance): Promise<ResultadoDoLance> {
    if (sessao.papel !== 'licitante') {
      throw new ErroApi({
        codigo: 'LEILOEIRO_NAO_PODE_LANCAR',
        status: HttpStatus.FORBIDDEN,
        mensagem: 'Leiloeiro não pode dar lance.',
      });
    }
    const { valorCentavos } = validar(esquemaDoLance, pedido.corpo);
    const chave = validar(esquemaDaChaveDoLance, pedido.chave);
    await this.limite.consumir(`lance:${sessao.id}`, REGRA_DO_LANCE);
    const loteId = await this.loteExistente(pedido.loteId);
    const validado: LanceValidado = { usuarioId: sessao.id, loteId, valorCentavos, chave };
    try {
      return await aposCommit(this.publicador, (coletor) =>
        this.banco.transaction((tx) => this.naTransacao(tx, coletor, validado)),
      );
    } catch (erro: unknown) {
      throw this.traduzirFalha(erro);
    }
  }

  /** Leitura sem lock antes do FOR UPDATE; devolve o id canônico gravado (minúsculas). */
  private async loteExistente(id: string): Promise<string> {
    if (!UUID_DO_LOTE.test(id)) throw loteNaoEncontrado();
    const [resumo] = await this.banco.consultar((db) => obterResumos(db, [id]));
    if (resumo === undefined) throw loteNaoEncontrado();
    return resumo.id;
  }

  private async naTransacao(
    tx: Transacao,
    coletor: ColetorDeEventos,
    pedido: LanceValidado,
  ): Promise<ResultadoDoLance> {
    // Primeiro comando da tx: o INSERT ON CONFLICT + FOR UPDATE da carteira depende disto.
    await tx.execute(sql`set transaction isolation level read committed`);
    const lote = await travarLote(tx, pedido.loteId);
    if (lote === null) throw loteNaoEncontrado();
    const instante = await agora(tx);
    const repetido = await buscarLancePorChave(tx, pedido.usuarioId, pedido.chave);
    if (repetido !== null) return repeticao(repetido, lote, pedido);
    const recusa = recusaDoLance(lote, instante, pedido.usuarioId, pedido.valorCentavos);
    if (recusa !== null) throw recusa;
    return this.gravar(tx, coletor, pedido, lote, instante);
  }

  private async gravar(
    tx: Transacao,
    coletor: ColetorDeEventos,
    pedido: LanceValidado,
    lote: LoteTravado,
    instante: Date,
  ): Promise<ResultadoDoLance> {
    const { usuarioId, loteId, valorCentavos } = pedido;
    const anexado = await this.cadeia.anexar(tx, {
      loteId,
      licitanteId: usuarioId,
      valorCentavos,
      criadoEm: instante,
      idempotencyKey: pedido.chave,
    });
    const anterior = liderAnterior(lote, anexado);
    // D12: as carteiras em ordem crescente de user_id, antes de comprometer e liberar.
    await travarCarteiras(tx, anterior === null ? [usuarioId] : [usuarioId, anterior.liderId]);
    const saldoNovo = await comprometerOuRecusar(tx, usuarioId, valorCentavos, {
      loteId,
      lanceId: anexado.id,
    });
    const saldoAnterior =
      anterior === null
        ? null
        : await liberar(tx, anterior.liderId, anterior.valorCentavos, {
            loteId,
            lanceId: anterior.lanceId,
          });
    const novoFimEm = fimDepoisDoLance(lote.fimEm, instante);
    const depois = await registrarLance(tx, loteId, {
      valorCentavos,
      liderId: usuarioId,
      ...(novoFimEm === undefined ? {} : { novoFimEm }),
    });
    if (depois === null) throw new Error('lote travado sumiu no registrarLance');
    const lance = lancePublico(anexado, anexado.criadoEm);
    const eventos = eventosDoLance({
      loteId,
      lance,
      fimAntes: lote.fimEm,
      fimDepois: depois.fimEm,
      totalLances: depois.totalLances,
      novoLider: { id: usuarioId, saldo: saldoNovo },
      liderAnterior:
        anterior === null || saldoAnterior === null
          ? null
          : { id: anterior.liderId, saldo: saldoAnterior },
    });
    // Saldos lidos nesta tx (pós-comprometer/liberar); publicados só depois do COMMIT. Os
    // privados levam o `usuarioId` do destinatário para o room `usuario:{id}` (specs/009).
    for (const evento of [...eventos.publicos, ...eventos.privados]) coletor.agendar(evento);
    return {
      criado: true,
      dados: {
        lance,
        lote: {
          lanceAtualCentavos: depois.lanceAtualCentavos,
          fimEm: depois.fimEm.toISOString(),
          totalLances: depois.totalLances,
        },
      },
    };
  }

  /** Falha da transação (já em rollback) → resposta do contrato; nunca loga chave nem valores. */
  private traduzirFalha(erro: unknown): unknown {
    const traduzido = traduzirFalhaDoLance(erro);
    if (traduzido !== erro) {
      const motivo =
        erro instanceof ErroDeCarteira ? erro.codigo : (erro as { codigo?: unknown }).codigo;
      this.#logger.warn(`lance não aplicado (${String(motivo)})`);
    }
    return traduzido;
  }
}
