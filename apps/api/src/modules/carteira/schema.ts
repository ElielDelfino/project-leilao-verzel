// Tabelas do módulo carteira (specs/004 §Dados, tarefa 037). Migration: 0001_identidade_carteira.
// Dinheiro em centavos, bigint no banco e `number` seguro (≤ 2^53) na API (ADR 0001).
//
// O que fica só no SQL da migration (o drizzle-kit não gera ou a fronteira de módulos impede):
// - FKs de user_id para users(id), sem CASCADE: users é de identidade, e carteira não importa
//   outro módulo (specs/001 §Módulos), então a referência não é declarada aqui;
// - os triggers append-only de ledger_entries (public.impedir_alteracao(), specs/008);
// - os GRANTs ao papel da API (matriz D3 da tarefa 036): ledger_entries SELECT, INSERT;
//   wallet_balances SELECT, INSERT, UPDATE.
// - as FKs lote_id → lots(id) e lance_id → bids(id), imediatas e sem índice (migration
//   0003_lances_integridade, D9 da ADR 0031): o lançamento do lance vem depois do `bids`.
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  pgTable,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { tipoLancamento } from '../../db/schema.js';

/**
 * Maior valor em centavos: 2^53 − 1. As colunas bigint são lidas em modo `number` (ADR 0001), e
 * acima disto o Number() do Drizzle perderia precisão em silêncio; o CHECK impede que o banco
 * chegue lá. Igual ao `maximum` de `Centavos` no openapi.yaml.
 */
export const CENTAVOS_MAXIMO = Number.MAX_SAFE_INTEGER;

const maximo = sql.raw(String(CENTAVOS_MAXIMO));

/** Lançamento do ledger: append-only (UPDATE, DELETE e TRUNCATE recusados com 23001). */
export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid('user_id').notNull(),
    tipo: tipoLancamento('tipo').notNull(),
    valorCentavos: bigint('valor_centavos', { mode: 'number' }).notNull(),
    loteId: uuid('lote_id'),
    lanceId: uuid('lance_id'),
    idempotencyKey: uuid('idempotency_key'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('ledger_entries_valor_positivo', sql`${t.valorCentavos} > 0`),
    check('ledger_entries_valor_seguro', sql`${t.valorCentavos} <= ${maximo}`),
    // Idempotência do depósito (specs/004 §Comportamento); várias linhas com chave nula são aceitas.
    unique('ledger_entries_user_id_idempotency_key_unique').on(t.userId, t.idempotencyKey),
    // Extrato do mais recente para o mais antigo (specs/004 RF-04); id desempata o mesmo instante.
    // NULLS FIRST é o padrão do DESC: o índice casa com `order by criado_em desc, id desc`.
    index('ledger_entries_user_id_criado_em_id_idx').on(
      t.userId,
      t.criadoEm.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
    // No máximo um `compromisso` e uma `liberacao` por lance (tarefa 092, migration 0004): um
    // retry ou bug do chamador não compromete nem libera o mesmo lance duas vezes. A tarefa 093
    // identifica a violação (23505) por este nome; o `estorno` do cancelamento não entra aqui.
    uniqueIndex('ledger_entries_lance_id_tipo_unico')
      .on(t.lanceId, t.tipo)
      .where(sql`${t.tipo} IN ('compromisso', 'liberacao') AND ${t.lanceId} IS NOT NULL`),
    // No máximo um `estorno`, um `debito_arremate` e um `credito_arremate` por lote (tarefa 102,
    // migration 0005, D4): o cancelamento e a liquidação não rodam duas vezes no mesmo lote.
    uniqueIndex('ledger_entries_lote_id_tipo_unico')
      .on(t.loteId, t.tipo)
      .where(
        sql`${t.tipo} IN ('estorno', 'debito_arremate', 'credito_arremate') AND ${t.loteId} IS NOT NULL`,
      ),
  ],
);

/** Projeção do ledger por usuário: travada com FOR UPDATE por quem altera o saldo. */
export const walletBalances = pgTable(
  'wallet_balances',
  {
    userId: uuid('user_id').primaryKey(),
    totalCentavos: bigint('total_centavos', { mode: 'number' }).notNull().default(0),
    comprometidoCentavos: bigint('comprometido_centavos', { mode: 'number' }).notNull().default(0),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'wallet_balances_comprometido_valido',
      sql`${t.comprometidoCentavos} >= 0 AND ${t.comprometidoCentavos} <= ${t.totalCentavos}`,
    ),
    check('wallet_balances_total_seguro', sql`${t.totalCentavos} <= ${maximo}`),
    check('wallet_balances_comprometido_seguro', sql`${t.comprometidoCentavos} <= ${maximo}`),
  ],
);
