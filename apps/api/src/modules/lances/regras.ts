// Regras puras do lance (specs/007 §Transação passos 3 e 7, §Eventos; ADR 0031 D10) e a tradução
// das falhas da transação em respostas do contrato. Sem I/O: o serviço passa o lote travado e o
// `agora(tx)` lido uma vez depois do lock.
import { HttpStatus } from '@nestjs/common';

import { ErroApi } from '../../common/erros/erro-api.js';
import type { EventoDeDominio } from '../../common/eventos/publicador-de-eventos.js';
import { ErroDoBanco } from '../../db/banco.js';
import { ErroDeCarteira, type SaldoComDisponivel } from '../carteira/index.js';
import type { LoteTravado } from '../lotes/index.js';

/** Anti-sniping: lance a menos disto do fim estende o fim para agora + isto (RF-05). */
export const JANELA_ANTI_SNIPING_MS = 2 * 60 * 1000;

/** O que as verificações leem do lote travado. */
export type LoteParaRegras = Pick<
  LoteTravado,
  | 'status'
  | 'inicioEm'
  | 'fimEm'
  | 'lanceInicialCentavos'
  | 'incrementoMinimoCentavos'
  | 'lanceAtualCentavos'
  | 'liderId'
>;

const LOCK_TIMEOUT = '55P03';
const DEADLOCK = '40P01';
const VIOLACAO_DE_UNICIDADE = '23505';
/** unique (licitante_id, idempotency_key) de bids (schema.ts de lances). */
const UNIQUE_DA_CHAVE = 'bids_licitante_id_idempotency_key_unique';

function recusa(
  codigo: 'LOTE_ENCERRADO' | 'LOTE_NAO_INICIADO' | 'JA_ESTA_GANHANDO' | 'LANCE_ABAIXO_DO_MINIMO',
  mensagem: string,
  detalhes?: Readonly<Record<string, number>>,
): ErroApi {
  return new ErroApi({
    codigo,
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    mensagem,
    ...(detalhes ? { detalhes } : {}),
  });
}

export function indisponivel(): ErroApi {
  return new ErroApi({
    codigo: 'INDISPONIVEL',
    status: HttpStatus.SERVICE_UNAVAILABLE,
    mensagem: 'Serviço temporariamente indisponível. Tente novamente.',
  });
}

export function dadosInvalidos(): ErroApi {
  return new ErroApi({
    codigo: 'DADOS_INVALIDOS',
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    mensagem: 'Requisição inválida.',
  });
}

/** Lance inicial se o lote não tem lance; senão lance atual + incremento (RF-02). */
export function minimoDoLance(lote: LoteParaRegras): number {
  return lote.lanceAtualCentavos === null
    ? lote.lanceInicialCentavos
    : lote.lanceAtualCentavos + lote.incrementoMinimoCentavos;
}

/**
 * Primeira recusa na ordem de specs/007 §Transação passo 3, ou `null`. "Ao vivo" sai só de
 * `inicio_em`, `fim_em` e do cancelamento; o status `ao_vivo`/`encerrado` gravado não entra.
 * SALDO_INSUFICIENTE não é decidido aqui: vem de `carteira.comprometer`.
 */
export function recusaDoLance(
  lote: LoteParaRegras,
  agora: Date,
  usuarioId: string,
  valorCentavos: number,
): ErroApi | null {
  if (lote.status === 'cancelado' || agora.getTime() >= lote.fimEm.getTime()) {
    return recusa('LOTE_ENCERRADO', 'O lote está encerrado.');
  }
  if (agora.getTime() < lote.inicioEm.getTime()) {
    return recusa('LOTE_NAO_INICIADO', 'O lote ainda não começou.');
  }
  if (lote.liderId === usuarioId) {
    return recusa('JA_ESTA_GANHANDO', 'Você já está ganhando este lote.');
  }
  const minimoCentavos = minimoDoLance(lote);
  if (valorCentavos < minimoCentavos) {
    return recusa('LANCE_ABAIXO_DO_MINIMO', 'O lance está abaixo do mínimo.', { minimoCentavos });
  }
  return null;
}

/** `agora + 2 min` se `fim − agora < 2 min`; senão `undefined` (o fim não muda). */
export function fimDepoisDoLance(fimEm: Date, agora: Date): Date | undefined {
  return fimEm.getTime() - agora.getTime() < JANELA_ANTI_SNIPING_MS
    ? new Date(agora.getTime() + JANELA_ANTI_SNIPING_MS)
    : undefined;
}

/**
 * Dentro da `tx`, em volta de `comprometer`: SALDO_INSUFICIENTE do próprio licitante vira 422 com
 * só `disponivelCentavos` (nunca o objeto inteiro). Quem chama sempre relança o resultado, para a
 * transação dar rollback. Qualquer outro erro volta como veio.
 */
export function traduzirRecusaDeSaldo(erro: unknown): unknown {
  if (
    erro instanceof ErroDeCarteira &&
    erro.codigo === 'SALDO_INSUFICIENTE' &&
    erro.disponivel !== undefined
  ) {
    return new ErroApi({
      codigo: 'SALDO_INSUFICIENTE',
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      mensagem: 'Saldo disponível insuficiente.',
      detalhes: { disponivelCentavos: erro.disponivel },
    });
  }
  return erro;
}

/**
 * Falha que saiu da transação (já em rollback) → resposta do contrato. Contenção de lock (55P03)
 * e deadlock (40P01) → 503; a mesma chave em outro lote, em paralelo → 422 DADOS_INVALIDOS
 * (ADR 0031 D5); ErroDeCarteira que não é a recusa de saldo do licitante (retry ou bug: o lance
 * não aplicou) → 503 sem detalhes. O resto volta como veio.
 */
export function traduzirFalhaDoLance(erro: unknown): unknown {
  if (erro instanceof ErroDoBanco) {
    if (erro.codigo === LOCK_TIMEOUT || erro.codigo === DEADLOCK) return indisponivel();
    if (erro.codigo === VIOLACAO_DE_UNICIDADE && erro.restricao === UNIQUE_DA_CHAVE) {
      return dadosInvalidos();
    }
    return erro;
  }
  if (erro instanceof ErroDeCarteira) return indisponivel();
  return erro;
}

/** Lance como vai na resposta e no evento: sem id interno nem dado do licitante. */
export interface LancePublico {
  readonly seq: number;
  readonly pseudonimo: string;
  readonly valorCentavos: number;
  readonly criadoEm: string;
}

export interface ParticipanteDoLance {
  readonly id: string;
  readonly saldo: SaldoComDisponivel;
}

export interface DadosDosEventos {
  readonly loteId: string;
  readonly lance: LancePublico;
  readonly fimAntes: Date;
  readonly fimDepois: Date;
  readonly totalLances: number;
  readonly novoLider: ParticipanteDoLance;
  readonly liderAnterior: ParticipanteDoLance | null;
}

/** Evento do room `usuario:{usuarioId}` (specs/009): o destinatário vai fora do payload (D8). */
export type EventoPrivado = EventoDeDominio & { readonly usuarioId: string };

export interface EventosDoLance {
  /** Rooms `lote:{id}` e `vitrine`; sem destinatário. */
  readonly publicos: readonly EventoDeDominio[];
  readonly privados: readonly EventoPrivado[];
}

/**
 * Eventos de specs/007 §Eventos, na ordem de publicação, depois do COMMIT. `voce_foi_superado`
 * só para um líder anterior que não seja o próprio licitante (JA_ESTA_GANHANDO já o impede;
 * a guarda evita avisar alguém de que superou a si mesmo).
 */
export function eventosDoLance(dados: DadosDosEventos): EventosDoLance {
  const { loteId, lance, fimAntes, fimDepois, totalLances, novoLider, liderAnterior } = dados;
  const fimEm = fimDepois.toISOString();
  const aceito: EventoDeDominio = {
    tipo: 'lance_aceito',
    payload: { loteId, ...lance, fimEm, totalLances },
  };
  const estendido: EventoDeDominio[] =
    fimDepois.getTime() === fimAntes.getTime()
      ? []
      : [{ tipo: 'fim_estendido', payload: { loteId, fimEm } }];
  const saldo = (p: ParticipanteDoLance): EventoPrivado => ({
    usuarioId: p.id,
    tipo: 'saldo_atualizado',
    payload: p.saldo,
  });
  const superado = liderAnterior !== null && liderAnterior.id !== novoLider.id;
  const privados: EventoPrivado[] = superado
    ? [
        {
          usuarioId: liderAnterior.id,
          tipo: 'voce_foi_superado',
          payload: { loteId, valorCentavos: lance.valorCentavos },
        },
        saldo(novoLider),
        saldo(liderAnterior),
      ]
    : [saldo(novoLider)];
  return { publicos: [aceito, ...estendido], privados };
}
