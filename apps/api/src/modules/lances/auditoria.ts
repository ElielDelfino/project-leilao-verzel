// Auditoria pública no servidor (tarefa 081; specs/008 §Verificação e §Interfaces e contratos,
// specs/011, ADR 0031 D7): cadeia inteira do lote, selo, veredito de `verificarCadeia` e as chaves
// públicas de `signing_keys`. Só leitura. O lote vem da interface pública de `lotes`; nada aqui
// seleciona `licitante_id`, nome ou e-mail, e a resposta é montada campo a campo pelo contrato.
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { SchemasApi } from '@leilao/contracts';
import { sql } from 'drizzle-orm';

import { ErroApi } from '../../common/erros/erro-api.js';
import { BANCO } from '../../config/banco.module.js';
import { type Banco, ErroDoBanco, type Transacao } from '../../db/banco.js';
import { obterResumos, type ResumoDoLote } from '../lotes/index.js';
import { UUID_DO_LOTE } from './esquemas.js';
import { verificarCadeia } from './integridade/verificacao.js';
import {
  type ChaveLida,
  type LinhaDaCadeia,
  lerSeloDoLote,
  listarCadeiaDoLote,
  listarChavesPublicas,
  type SeloLido,
} from './repositorio.js';

type Auditoria = SchemasApi['Auditoria'];
type LanceDaCadeia = SchemasApi['LanceDaCadeia'];
type SeloDoLote = SchemasApi['SeloDoLote'];
type ChavePublica = SchemasApi['ChavePublica'];

/** Algoritmo de toda chave publicada (specs/008 §Chaves). */
const ALGORITMO = 'Ed25519';

/**
 * Leitura num snapshot só (REPEATABLE READ, somente leitura): lote, cadeia, selo e chaves vêm do
 * mesmo instante. Sem isso, um último lance e o selo gravados entre a leitura da cadeia e a do
 * selo dariam `SELO_TOTAL_DIVERGENTE` falso. Em READ COMMITTED (o padrão) cada SELECT enxerga um
 * snapshot novo; no REPEATABLE READ o snapshot fixa na primeira consulta. `read only` evita ainda
 * que a transação segure um id de transação de escrita e não gera conflito de serialização.
 */
const SNAPSHOT_DE_LEITURA = { isolationLevel: 'repeatable read', accessMode: 'read only' } as const;

/**
 * Teto de lances por lote na verificação do servidor. A cadeia inteira é lida e recalculada a cada
 * consulta pública; acima do teto a resposta é 503 explícito, nunca uma cadeia truncada (truncar
 * mudaria o veredito: `SELO_TOTAL_DIVERGENTE` falso ou cadeia "íntegra" parcial).
 */
export const TETO_DE_LANCES_DA_AUDITORIA = 1000;

/** Freio das leituras públicas: com o Redis fora o rate limit falha aberto (specs/011). */
const STATEMENT_TIMEOUT_DA_AUDITORIA_MS = 5000;

/**
 * `statement_timeout` de `ms` só nesta transação (`set_config(..., is_local => true)`, o mesmo
 * que SET LOCAL): no COMMIT ou ROLLBACK a conexão volta ao valor do pool, sem vazar para a próxima
 * requisição. Consulta mais lenta é cancelada pelo Postgres com 57014.
 */
export async function limitarDuracaoDaTransacao(tx: Transacao, ms: number): Promise<void> {
  await tx.execute(sql`select set_config('statement_timeout', ${String(ms)}, true)`);
}

/** 503 sem `detalhes`: cadeia acima do teto ou banco indisponível (specs/011, specs/001 §Erros). */
function indisponivel(): ErroApi {
  return new ErroApi({
    codigo: 'INDISPONIVEL',
    status: HttpStatus.SERVICE_UNAVAILABLE,
    mensagem: 'Serviço temporariamente indisponível. Tente novamente.',
  });
}

/** Só o que vai ao log de uma falha do banco: nunca a mensagem, o endereço nem o erro do driver. */
interface FalhaDoBanco {
  readonly nome: string;
  readonly codigo: string;
}

/**
 * Falha do banco que a auditoria responde com 503: um ErroDoBanco (SQLSTATE, inclusive o 57014
 * do statement_timeout) ou o erro de sistema cru que o pool lança ao não conseguir conectar
 * (ECONNREFUSED, ETIMEDOUT...: Error com `code` e `syscall`, que `src/db` não converte quando
 * vem do BEGIN da transação). Qualquer outra coisa (ErroApi, bug, dado inconsistente) → undefined.
 */
function falhaDoBanco(erro: unknown): FalhaDoBanco | undefined {
  if (erro instanceof ErroDoBanco) return { nome: erro.name, codigo: erro.codigo ?? 'sem código' };
  if (
    erro instanceof Error &&
    'code' in erro &&
    typeof erro.code === 'string' &&
    'syscall' in erro &&
    typeof erro.syscall === 'string'
  ) {
    return { nome: erro.name, codigo: erro.code };
  }
  return undefined;
}

function loteNaoEncontrado(): ErroApi {
  return new ErroApi({
    codigo: 'NAO_ENCONTRADO',
    status: HttpStatus.NOT_FOUND,
    mensagem: 'Lote não encontrado.',
  });
}

/** Lote → `LoteDaAuditoria`, campo a campo: `liderId` e `vencedorId` do resumo nunca saem. */
function paraLoteDaAuditoria(resumo: ResumoDoLote): Auditoria['lote'] {
  return {
    id: resumo.id,
    titulo: resumo.titulo,
    cartaNome: resumo.cartaNome,
    status: resumo.status,
    inicioEm: resumo.inicioEm.toISOString(),
    fimEm: resumo.fimEm.toISOString(),
    totalLances: resumo.totalLances,
  };
}

function paraLanceDaCadeia(linha: LinhaDaCadeia): LanceDaCadeia {
  return {
    seq: linha.seq,
    pseudonimo: linha.pseudonimo,
    valorCentavos: linha.valorCentavos,
    criadoEm: linha.criadoEm.toISOString(),
    hashAnterior: linha.hashAnterior,
    hash: linha.hash,
    assinatura: linha.assinatura,
    keyId: linha.keyId,
  };
}

function paraSeloDoLote(selo: SeloLido): SeloDoLote {
  return {
    status: selo.status,
    totalLances: selo.totalLances,
    hashFinal: selo.hashFinal,
    vencedorPseudonimo: selo.vencedorPseudonimo,
    valorArremateCentavos: selo.valorArremateCentavos,
    seladoEm: selo.seladoEm.toISOString(),
    assinatura: selo.assinatura,
    keyId: selo.keyId,
  };
}

function paraChavePublica(chave: ChaveLida): ChavePublica {
  return {
    keyId: chave.keyId,
    algoritmo: ALGORITMO,
    chavePublica: chave.chavePublica.toString('base64url'),
    ativaDesde: chave.ativaDesde.toISOString(),
  };
}

@Injectable()
export class ServicoDeAuditoria {
  readonly #logger = new Logger('Auditoria');

  constructor(@Inject(BANCO) private readonly banco: Banco) {}

  /**
   * Leitura no snapshot somente leitura com o freio de duração. Um ErroDoBanco (inclusive o
   * 57014 do statement_timeout) vira 503 INDISPONIVEL sem `detalhes` (specs/011 §Rate limit); o
   * log leva só o nome e o código, nunca a mensagem (nomes do schema) nem o erro do driver. Os
   * ErroApi (404, 503 do teto) e qualquer outra falha sobem como vieram.
   */
  async #lerComFreio<T>(leitura: (tx: Transacao) => Promise<T>): Promise<T> {
    try {
      return await this.banco.consultar((db) =>
        db.transaction(async (tx) => {
          await limitarDuracaoDaTransacao(tx, STATEMENT_TIMEOUT_DA_AUDITORIA_MS);
          return leitura(tx);
        }, SNAPSHOT_DE_LEITURA),
      );
    } catch (erro: unknown) {
      const falha = falhaDoBanco(erro);
      if (falha === undefined) throw erro;
      this.#logger.warn(`auditoria: banco indisponível (${falha.nome} ${falha.codigo})`);
      throw indisponivel();
    }
  }

  /**
   * Auditoria do lote: cadeia inteira por `seq` crescente, selo (ou null) e o veredito recalculado
   * agora, sobre as mesmas linhas devolvidas. Lote inexistente, ou id que não é UUID → 404.
   * O veredito usa os mesmos campos que o navegador recebe (hex e base64url já convertidos).
   */
  async auditoriaDoLote(loteId: string): Promise<Auditoria> {
    if (!UUID_DO_LOTE.test(loteId)) throw loteNaoEncontrado();
    const lido = await this.#lerComFreio(async (tx) => {
      const [lote] = await obterResumos(tx, [loteId]);
      if (lote === undefined) throw loteNaoEncontrado();
      if (lote.totalLances > TETO_DE_LANCES_DA_AUDITORIA) throw indisponivel();
      // Em sequência: uma conexão por requisição (a transação já a segura). No máximo TETO + 1
      // linhas: a que passa do teto basta para recusar, e a resposta 200 nunca é truncada.
      const cadeia = await listarCadeiaDoLote(tx, lote.id, TETO_DE_LANCES_DA_AUDITORIA + 1);
      // Defesa: o contador do resumo pode estar defasado em relação às linhas lidas.
      if (cadeia.length > TETO_DE_LANCES_DA_AUDITORIA) throw indisponivel();
      const selo = await lerSeloDoLote(tx, lote.id);
      const chaves = await listarChavesPublicas(tx);
      return { lote, cadeia, selo, chaves };
    });
    const lances = lido.cadeia.map(paraLanceDaCadeia);
    const selo = lido.selo === null ? null : paraSeloDoLote(lido.selo);
    // `lote.id` vem do banco (UUID em minúsculas), o formato que a gênese exige.
    const { veredito, problemas } = verificarCadeia({
      loteId: lido.lote.id,
      lances,
      selo,
      chaves: lido.chaves.map((c) => ({ keyId: c.keyId, chavePublica: c.chavePublica })),
    });
    return {
      lote: paraLoteDaAuditoria(lido.lote),
      lances,
      selo,
      veredito,
      problemas: problemas.map((p) => ({ codigo: p.codigo, seq: p.seq, mensagem: p.mensagem })),
    };
  }

  /** Toda chave pública já registrada, por `ativaDesde` crescente (desempate `keyId`). */
  async chavesPublicadas(): Promise<ChavePublica[]> {
    const chaves = await this.#lerComFreio((tx) => listarChavesPublicas(tx));
    return chaves.map(paraChavePublica);
  }
}
