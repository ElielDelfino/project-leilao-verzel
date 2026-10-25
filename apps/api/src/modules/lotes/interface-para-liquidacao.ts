// Interface de lotes para o módulo liquidacao (tarefa 104; specs/006 §Interface interna para
// `liquidacao`, specs/010). Liquidacao não lê `lots`: abre, varre, trava, encerra e cancela só por
// estas funções, recebendo a `tx` dela para que lote, carteiras e selo fiquem na mesma transação.
//
// Ordem de locks (specs/004): o lote SEMPRE antes das carteiras. Quem chama trava o lote
// (`travarLoteVencido` ou `travarLote`) antes de qualquer operação de carteira na mesma `tx`.
// Nenhuma função lê nome nem e-mail; `vencedorId` e `liderId` são só ids.
import { and, asc, eq, inArray, lte, notInArray, sql } from 'drizzle-orm';

import type { BancoDrizzle, Transacao } from '../../db/banco.js';
import type { LoteTravado } from './interface-para-lances.js';
import { lots } from './schema.js';

export type CodigoDoErroDeLote = 'ESTADO_INVALIDO' | 'ARREMATE_INCOERENTE' | 'FIM_VENCIDO';

/**
 * Recusa de domínio (não HTTP); exige rollback da `tx` de quem chama.
 * - ESTADO_INVALIDO: nenhuma linha mudou (lote inexistente, fora do status exigido ou, no
 *   encerramento, vencedor ou valor divergentes de `lider_id`, `lance_atual_centavos` e
 *   `total_lances`).
 * - ARREMATE_INCOERENTE: `vencedorId` e valor não são ambos nulos nem ambos presentes, ou o valor
 *   não é inteiro positivo; recusado antes de tocar o banco.
 * - FIM_VENCIDO: só no cancelamento; o lote está `agendado` ou `ao_vivo`, mas `fim_em` já passou
 *   no relógio do banco. O status derivado é `encerrado` e o lote é do job (ADR 0032); quem expõe
 *   em HTTP mapeia para 409 `LOTE_ENCERRADO`, como o ESTADO_INVALIDO do cancelamento.
 */
export class ErroDeLote extends Error {
  readonly codigo: CodigoDoErroDeLote;
  readonly loteId: string;

  constructor(codigo: CodigoDoErroDeLote, loteId: string) {
    super(`operação no lote recusada: ${codigo}`);
    this.name = 'ErroDeLote';
    this.codigo = codigo;
    this.loteId = loteId;
  }
}

/** Resultado do encerramento: ambos nulos (sem lances) ou ambos presentes. */
export interface ResultadoDoEncerramento {
  readonly vencedorId: string | null;
  readonly valorArremateCentavos: number | null;
  readonly encerradoEm: Date;
}

export const LIMITE_PADRAO_DE_INICIO = 50;
export const LIMITE_PADRAO_DE_CANDIDATOS = 20;

function exigirLimite(limite: number): void {
  if (!Number.isSafeInteger(limite) || limite < 1) {
    throw new RangeError(`limite deve ser inteiro positivo: ${String(limite)}`);
  }
}

/**
 * Passa a `ao_vivo` até `limite` lotes `agendado` com `inicio_em <= now()` e devolve os ids.
 * SKIP LOCKED: lotes travados por outra transação ficam para o próximo tick, sem espera.
 */
export async function iniciarLotesPendentes(
  tx: Transacao,
  limite: number = LIMITE_PADRAO_DE_INICIO,
): Promise<string[]> {
  exigirLimite(limite);
  // CTE materializada: o LIMIT com SKIP LOCKED roda uma vez só. Numa subconsulta em `IN`, o
  // planejador pode reexecutá-la e passar do limite.
  const { rows } = await tx.execute<{ id: string }>(sql`
    with alvo as materialized (
      select ${lots.id} as id from ${lots}
       where ${lots.status} = 'agendado' and ${lots.inicioEm} <= now()
       order by ${lots.inicioEm}
       limit ${limite}
       for update skip locked
    )
    update ${lots} set status = 'ao_vivo'
      from alvo
     where ${lots.id} = alvo.id and ${lots.status} = 'agendado'
    returning ${lots.id} as id`);
  return rows.map((l) => l.id);
}

/**
 * Ids `ao_vivo` com `fim_em <= now()`, por `fim_em` crescente, SEM lock: a varredura do job
 * (specs/010). Cada id é reconferido sob lock por `travarLoteVencido` na transação do lote.
 * `excluirIds` são os lotes em backoff ("veneno", specs/010), fora da seleção para não ocuparem
 * o limite.
 */
export async function candidatosAoEncerramento(
  db: BancoDrizzle | Transacao,
  limite: number = LIMITE_PADRAO_DE_CANDIDATOS,
  excluirIds: readonly string[] = [],
): Promise<string[]> {
  exigirLimite(limite);
  const foraDoBackoff = excluirIds.length > 0 ? notInArray(lots.id, [...excluirIds]) : undefined;
  const linhas = await db
    .select({ id: lots.id })
    .from(lots)
    .where(and(eq(lots.status, 'ao_vivo'), lte(lots.fimEm, sql`now()`), foraDoBackoff))
    .orderBy(asc(lots.fimEm), asc(lots.id))
    .limit(limite);
  return linhas.map((l) => l.id);
}

/**
 * `SELECT … FOR UPDATE SKIP LOCKED` do lote `ao_vivo` com `fim_em <= clock_timestamp()`. `null`
 * se outra transação o travou (sem esperar), se já não está `ao_vivo` ou se o anti-sniping
 * estendeu o fim depois da varredura (D6): a condição é reavaliada sob o lock.
 */
export async function travarLoteVencido(tx: Transacao, id: string): Promise<LoteTravado | null> {
  const [linha] = await tx
    .select({
      id: lots.id,
      leiloeiroId: lots.leiloeiroId,
      status: lots.status,
      inicioEm: lots.inicioEm,
      fimEm: lots.fimEm,
      fimOriginalEm: lots.fimOriginalEm,
      lanceInicialCentavos: lots.lanceInicialCentavos,
      incrementoMinimoCentavos: lots.incrementoMinimoCentavos,
      lanceAtualCentavos: lots.lanceAtualCentavos,
      liderId: lots.liderId,
      totalLances: lots.totalLances,
    })
    .from(lots)
    .where(
      and(eq(lots.id, id), eq(lots.status, 'ao_vivo'), lte(lots.fimEm, sql`clock_timestamp()`)),
    )
    .for('update', { skipLocked: true });
  return linha ?? null;
}

function arremateCoerente(r: ResultadoDoEncerramento): boolean {
  if (r.vencedorId === null) return r.valorArremateCentavos === null;
  return (
    r.valorArremateCentavos !== null &&
    Number.isSafeInteger(r.valorArremateCentavos) &&
    r.valorArremateCentavos > 0
  );
}

/**
 * Grava `encerrado`, vencedor, valor e `encerrado_em`. Chame depois de `travarLoteVencido` na
 * mesma `tx`. O UPDATE só muda a linha se ela estiver `ao_vivo` e o resultado bater com o estado
 * gravado (dinheiro): `vencedorId` igual a `lider_id`, valor igual a `lance_atual_centavos` (os
 * dois nulos sem lances) e `total_lances` coerente. Do contrário, ESTADO_INVALIDO.
 *
 * `encerradoEm` deve vir do relógio do banco, `agora(tx)` do módulo lotes, lido sob o lock;
 * nunca de `new Date()` do app.
 */
export async function encerrarLote(
  tx: Transacao,
  id: string,
  resultado: ResultadoDoEncerramento,
): Promise<void> {
  if (!arremateCoerente(resultado)) throw new ErroDeLote('ARREMATE_INCOERENTE', id);
  const { vencedorId, valorArremateCentavos, encerradoEm } = resultado;
  const coerenteComLances =
    vencedorId === null ? eq(lots.totalLances, 0) : sql`${lots.totalLances} > 0`;
  const linhas = await tx
    .update(lots)
    .set({ status: 'encerrado', vencedorId, valorArremateCentavos, encerradoEm })
    .where(
      and(
        eq(lots.id, id),
        eq(lots.status, 'ao_vivo'),
        coerenteComLances,
        sql`${lots.liderId} is not distinct from ${vencedorId}::uuid`,
        sql`${lots.lanceAtualCentavos} is not distinct from ${valorArremateCentavos}::bigint`,
      ),
    )
    .returning({ id: lots.id });
  if (linhas.length === 0) throw new ErroDeLote('ESTADO_INVALIDO', id);
}

/**
 * Grava `cancelado` e `cancelado_em`. Chame depois de `travarLote` na mesma `tx`. Exige
 * `agendado` ou `ao_vivo` e `fim_em > clock_timestamp()`: defesa em profundidade da regra
 * "cancelar depois de `fim_em` dá 409" (specs/006 RF-04, specs/010, ADR 0032). Recusas:
 * FIM_VENCIDO se o status permite, mas o fim já passou; ESTADO_INVALIDO nos demais casos
 * (inexistente, `encerrado`, `cancelado`). Ambas viram 409 `LOTE_ENCERRADO` em HTTP.
 *
 * `canceladoEm` deve vir do relógio do banco, `agora(tx)` do módulo lotes, lido sob o lock;
 * nunca de `new Date()` do app.
 */
export async function cancelarLote(tx: Transacao, id: string, canceladoEm: Date): Promise<void> {
  const cancelavel = and(eq(lots.id, id), inArray(lots.status, ['agendado', 'ao_vivo']));
  const linhas = await tx
    .update(lots)
    .set({ status: 'cancelado', canceladoEm })
    .where(and(cancelavel, sql`${lots.fimEm} > clock_timestamp()`))
    .returning({ id: lots.id });
  if (linhas.length > 0) return;
  // Nenhuma linha: distingue o fim vencido do status inválido, com a mesma `tx` (sob o lock).
  const [ainda] = await tx.select({ id: lots.id }).from(lots).where(cancelavel);
  throw new ErroDeLote(ainda === undefined ? 'ESTADO_INVALIDO' : 'FIM_VENCIDO', id);
}
