// Acesso às tabelas do módulo carteira: ledger_entries e wallet_balances (specs/004 §Dados).
// Privilégios do papel da API (ADR 0026): ledger_entries SELECT, INSERT (append-only);
// wallet_balances SELECT, INSERT, UPDATE. Toda alteração de saldo acontece com a linha travada
// (FOR UPDATE) na transação de quem a causa.
import { and, desc, eq, sql } from 'drizzle-orm';

import type { BancoDrizzle, Transacao } from '../../db/banco.js';
import {
  type Efeito,
  inteiroSeguro,
  type SaldoEmCentavos,
  type TipoDeLancamento,
} from './efeito.js';
import { ledgerEntries, walletBalances } from './schema.js';

/** Banco fora de transação ou uma transação: as leituras servem às duas. */
export type Executor = BancoDrizzle | Transacao;

/** Lançamento como sai na API (openapi.yaml: Lancamento), ainda com o instante em Date. */
export interface LinhaDeLancamento {
  readonly id: string;
  readonly tipo: TipoDeLancamento;
  readonly valorCentavos: number;
  readonly loteId: string | null;
  readonly criadoEm: Date;
}

export const SALDO_ZERO: SaldoEmCentavos = Object.freeze({ total: 0, comprometido: 0 });

const COLUNAS_DO_LANCAMENTO = {
  id: ledgerEntries.id,
  tipo: ledgerEntries.tipo,
  valorCentavos: ledgerEntries.valorCentavos,
  loteId: ledgerEntries.loteId,
  criadoEm: ledgerEntries.criadoEm,
} as const;

const COLUNAS_DO_SALDO = {
  total: walletBalances.totalCentavos,
  comprometido: walletBalances.comprometidoCentavos,
} as const;

/** Confere que o bigint lido (modo number do Drizzle) não passou de 2^53 − 1. */
function saldoSeguro(linha: { total: number; comprometido: number }): SaldoEmCentavos {
  return { total: inteiroSeguro(linha.total), comprometido: inteiroSeguro(linha.comprometido) };
}

function lancamentoSeguro(linha: LinhaDeLancamento): LinhaDeLancamento {
  return { ...linha, valorCentavos: inteiroSeguro(linha.valorCentavos) };
}

/** Saldo sem trava; sem linha (nenhum lançamento ainda), zero (ADR 0027, D13). */
export async function lerSaldo(db: Executor, userId: string): Promise<SaldoEmCentavos> {
  const [linha] = await db
    .select(COLUNAS_DO_SALDO)
    .from(walletBalances)
    .where(eq(walletBalances.userId, userId));
  return linha === undefined ? SALDO_ZERO : saldoSeguro(linha);
}

/**
 * Cria a linha de wallet_balances se faltar (ela nasce no primeiro lançamento, ADR 0027) e a
 * trava com FOR UPDATE até o fim da transação. Devolve o saldo travado.
 */
export async function travarSaldo(tx: Transacao, userId: string): Promise<SaldoEmCentavos> {
  await tx.insert(walletBalances).values({ userId }).onConflictDoNothing({
    target: walletBalances.userId,
  });
  const [linha] = await tx
    .select(COLUNAS_DO_SALDO)
    .from(walletBalances)
    .where(eq(walletBalances.userId, userId))
    .for('update');
  if (linha === undefined) {
    throw new Error('linha de wallet_balances sumiu depois do INSERT');
  }
  return saldoSeguro(linha);
}

/** Aplica o efeito na projeção (linha já travada por travarSaldo) e devolve o novo saldo. */
export async function atualizarSaldo(
  tx: Transacao,
  userId: string,
  efeito: Efeito,
): Promise<SaldoEmCentavos> {
  const [linha] = await tx
    .update(walletBalances)
    .set({
      totalCentavos: sql`${walletBalances.totalCentavos} + ${efeito.total}`,
      comprometidoCentavos: sql`${walletBalances.comprometidoCentavos} + ${efeito.comprometido}`,
      atualizadoEm: sql`now()`,
    })
    .where(eq(walletBalances.userId, userId))
    .returning(COLUNAS_DO_SALDO);
  if (linha === undefined) {
    throw new Error('UPDATE em wallet_balances não devolveu a linha');
  }
  return saldoSeguro(linha);
}

export async function inserirLancamento(
  tx: Transacao,
  dados: {
    userId: string;
    tipo: TipoDeLancamento;
    valorCentavos: number;
    idempotencyKey?: string;
  },
): Promise<LinhaDeLancamento> {
  const [linha] = await tx.insert(ledgerEntries).values(dados).returning(COLUNAS_DO_LANCAMENTO);
  if (linha === undefined) {
    throw new Error('INSERT em ledger_entries não devolveu a linha');
  }
  return lancamentoSeguro(linha);
}

/** Lançamento já gravado com esta Idempotency-Key, se houver. */
export async function buscarPorChave(
  db: Executor,
  userId: string,
  idempotencyKey: string,
): Promise<LinhaDeLancamento | undefined> {
  const [linha] = await db
    .select(COLUNAS_DO_LANCAMENTO)
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.userId, userId), eq(ledgerEntries.idempotencyKey, idempotencyKey)));
  return linha === undefined ? undefined : lancamentoSeguro(linha);
}

/** Página do extrato, do mais recente para o mais antigo (specs/004 RF-04). */
export async function listarLancamentos(
  db: Executor,
  userId: string,
  pagina: { limite: number; deslocamento: number },
): Promise<readonly LinhaDeLancamento[]> {
  const linhas = await db
    .select(COLUNAS_DO_LANCAMENTO)
    .from(ledgerEntries)
    .where(eq(ledgerEntries.userId, userId))
    .orderBy(desc(ledgerEntries.criadoEm), desc(ledgerEntries.id))
    .limit(pagina.limite)
    .offset(pagina.deslocamento);
  return linhas.map(lancamentoSeguro);
}

export async function contarLancamentos(db: Executor, userId: string): Promise<number> {
  const [linha] = await db
    // count(*) é bigint: o pg o entrega como string, conferida por inteiroSeguro.
    .select({ total: sql<string>`count(*)` })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.userId, userId));
  return inteiroSeguro(linha?.total);
}
