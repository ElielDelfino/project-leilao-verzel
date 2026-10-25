// Interface de lotes para o módulo lances (tarefa 075; specs/007 §Transação do lance). Lances não
// lê `lots`: trava, atualiza e resume o lote só por estas funções, recebendo a `tx` dele para que
// lance, ledger e lote fiquem na mesma transação. "Agora" do lance é clock_timestamp(), lido do
// Postgres (nunca Date.now(), que diverge do relógio do banco).
import { eq, inArray, sql } from 'drizzle-orm';

import type { BancoDrizzle, Transacao } from '../../db/banco.js';
import { type LinhaDoLote, statusDerivado } from './repositorio.js';
import { lots } from './schema.js';

/** Status como gravado na coluna; o derivado dos horários sai de `agora(tx)` e dos prazos. */
export type StatusGravadoDoLote = 'agendado' | 'ao_vivo' | 'encerrado' | 'cancelado';

/** Linha travada com FOR UPDATE: o que a transação do lance precisa para validar e gravar. */
export interface LoteTravado {
  readonly id: string;
  readonly leiloeiroId: string;
  readonly status: StatusGravadoDoLote;
  readonly inicioEm: Date;
  readonly fimEm: Date;
  readonly fimOriginalEm: Date;
  readonly lanceInicialCentavos: number;
  readonly incrementoMinimoCentavos: number;
  readonly lanceAtualCentavos: number | null;
  readonly liderId: string | null;
  readonly totalLances: number;
}

export interface LanceNoLote {
  readonly valorCentavos: number;
  readonly liderId: string;
  /** Fim estendido pelo anti-sniping; nunca recua o fim atual (CHECK lots_fim_nao_recua). */
  readonly novoFimEm?: Date;
}

/** Estado do lote depois do lance (resposta 201 do lance e evento da sala). */
export interface LoteDepoisDoLance {
  readonly lanceAtualCentavos: number;
  readonly liderId: string;
  readonly fimEm: Date;
  readonly totalLances: number;
}

/**
 * Resumo para `GET /api/me/lances` e para o estado da sala. `liderId` e `vencedorId` servem só
 * para calcular a posição do usuário; nunca vão para uma resposta pública.
 */
export interface ResumoDoLote extends LinhaDoLote {
  readonly liderId: string | null;
  readonly vencedorId: string | null;
}

/** Leitura (fora ou dentro de transação). */
type Leitor = BancoDrizzle | Transacao;

/** `SELECT … FOR UPDATE` no lote; `null` se não existir. O lock vai até o fim da `tx`. */
export async function travarLote(tx: Transacao, loteId: string): Promise<LoteTravado | null> {
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
    .where(eq(lots.id, loteId))
    .for('update');
  return linha ?? null;
}

/**
 * Grava o lance aceito no lote: lance atual, líder, `total_lances + 1` e, com `novoFimEm`, o fim
 * estendido por `greatest`, que nunca recua o fim. Chame depois de `travarLote` na mesma `tx`.
 * `null` se o lote não existir.
 */
export async function registrarLance(
  tx: Transacao,
  loteId: string,
  lance: LanceNoLote,
): Promise<LoteDepoisDoLance | null> {
  const fimEm =
    lance.novoFimEm === undefined
      ? lots.fimEm
      : sql`greatest(${lots.fimEm}, ${lance.novoFimEm.toISOString()}::timestamptz)`;
  const [linha] = await tx
    .update(lots)
    .set({
      lanceAtualCentavos: lance.valorCentavos,
      liderId: lance.liderId,
      totalLances: sql`${lots.totalLances} + 1`,
      fimEm,
    })
    .where(eq(lots.id, loteId))
    .returning({
      lanceAtualCentavos: lots.lanceAtualCentavos,
      liderId: lots.liderId,
      fimEm: lots.fimEm,
      totalLances: lots.totalLances,
    });
  if (linha === undefined) return null;
  if (linha.lanceAtualCentavos === null || linha.liderId === null) {
    throw new Error('update em lots devolveu lance ou líder nulo');
  }
  return { ...linha, lanceAtualCentavos: linha.lanceAtualCentavos, liderId: linha.liderId };
}

/** Resumos dos lotes pedidos, sem ordem garantida; ids inexistentes ficam de fora. */
export async function obterResumos(db: Leitor, ids: readonly string[]): Promise<ResumoDoLote[]> {
  if (ids.length === 0) return [];
  return db
    .select({
      id: lots.id,
      titulo: lots.titulo,
      status: statusDerivado,
      cartaNome: lots.cartaNome,
      raridade: lots.raridade,
      snapshotId: lots.snapshotId,
      inicioEm: lots.inicioEm,
      fimEm: lots.fimEm,
      lanceInicialCentavos: lots.lanceInicialCentavos,
      incrementoMinimoCentavos: lots.incrementoMinimoCentavos,
      lanceAtualCentavos: lots.lanceAtualCentavos,
      totalLances: lots.totalLances,
      valorArremateCentavos: lots.valorArremateCentavos,
      criadoEm: lots.criadoEm,
      liderId: lots.liderId,
      vencedorId: lots.vencedorId,
    })
    .from(lots)
    .where(inArray(lots.id, [...ids]));
}

/**
 * clock_timestamp() do Postgres: avança dentro da transação (now() não avança). Lido como
 * milissegundos desde a época para não depender do formato textual do timestamptz.
 */
export async function agora(tx: Transacao): Promise<Date> {
  const { rows } = await tx.execute<{ ms: string }>(
    sql`select (extract(epoch from clock_timestamp()) * 1000)::text as ms`,
  );
  const ms = Number(rows[0]?.ms);
  if (!Number.isFinite(ms)) throw new Error('clock_timestamp() não devolveu um instante válido');
  return new Date(ms);
}
