// Tabelas do módulo lances (specs/007 §Dados, specs/008 §Dados, ADR 0031; tarefa 073).
// Migration: 0003_lances_integridade. As três são append-only (specs/008 §Técnica).
//
// O que fica só no SQL da migration (o drizzle-kit não gera ou a fronteira de módulos impede):
// - FKs bids.lote_id e lot_seals.lote_id → lots(id) e bids.licitante_id → users(id), sem CASCADE:
//   lances não importa lotes nem identidade (specs/001 §Módulos);
// - FKs de carteira para cá e para lotes (D9 da ADR 0031): ledger_entries.lote_id → lots(id) e
//   ledger_entries.lance_id → bids(id), imediata (o `anexar` em bids vem antes do ledger);
// - os triggers append-only (public.impedir_alteracao(), linha e BEFORE TRUNCATE) nas três;
// - os GRANTs ao papel da API (ADR 0026): só SELECT e INSERT nas três.
// As FKs de key_id → signing_keys são do mesmo módulo e ficam declaradas aqui.
//
// Colunas de integridade em bytes: hash e hash_anterior (SHA-256, 32), assinatura (Ed25519, 64) e
// chave_publica (Ed25519, 32); a API converte para hex ou base64url (specs/008 §Codificações).
// criado_em e selado_em com 3 casas: guardam exatamente o instante assinado (specs/008).
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { bytea } from '../../db/colunas.js';

/** Lance mínimo de qualquer lote (specs/006 §Criação: lance inicial ≥ R$ 1,00). */
export const CENTAVOS_MINIMO_DO_LANCE = 100;

/**
 * Teto de centavos: 2^53 − 1, como em carteira (ADR 0001); bigint lido em modo `number`. Igual ao
 * `maximum` de `valorCentavos` no openapi.yaml. Repetido aqui porque lances não importa carteira.
 */
export const CENTAVOS_MAXIMO_DO_LANCE = Number.MAX_SAFE_INTEGER;

/** Tamanhos em bytes: SHA-256, assinatura Ed25519 e chave pública Ed25519. */
export const BYTES_DO_HASH = 32;
export const BYTES_DA_ASSINATURA = 64;
export const BYTES_DA_CHAVE_PUBLICA = 32;

/** key_id: 16 primeiros hex minúsculos de SHA-256(chave pública) (specs/008 §Chaves). */
export const CARACTERES_DO_KEY_ID = 16;

/** Status de um selo: o lote só é selado ao encerrar ou ao cancelar (specs/008 §Técnica). */
export const STATUS_DO_SELO = ['encerrado', 'cancelado'] as const;

const minimo = sql.raw(String(CENTAVOS_MINIMO_DO_LANCE));
const maximo = sql.raw(String(CENTAVOS_MAXIMO_DO_LANCE));
const bytesDoHash = sql.raw(String(BYTES_DO_HASH));
const bytesDaAssinatura = sql.raw(String(BYTES_DA_ASSINATURA));
const bytesDaChave = sql.raw(String(BYTES_DA_CHAVE_PUBLICA));
const caracteresDoKeyId = sql.raw(String(CARACTERES_DO_KEY_ID));
const formatoDoKeyId = sql.raw(`'^[0-9a-f]{${String(CARACTERES_DO_KEY_ID)}}$'`);
/** Pseudônimo público: "Licitante #" + 6 hex minúsculos (specs/008 §Técnica). */
export const FORMATO_DO_PSEUDONIMO = '^Licitante #[0-9a-f]{6}$';
const formatoDoPseudonimo = sql.raw(`'${FORMATO_DO_PSEUDONIMO}'`);
const statusDoSelo = sql.raw(STATUS_DO_SELO.map((status) => `'${status}'`).join(', '));

/**
 * Chaves públicas que já assinaram (ADR 0031 D1). A API registra a ativa no boot com
 * `INSERT ... ON CONFLICT (key_id) DO NOTHING`; uma rotação acrescenta uma linha.
 */
export const signingKeys = pgTable(
  'signing_keys',
  {
    keyId: text('key_id').primaryKey(),
    chavePublica: bytea('chave_publica').notNull(),
    // Instante do primeiro registro; o ON CONFLICT DO NOTHING não o altera ao reiniciar.
    ativaDesde: timestamp('ativa_desde', { withTimezone: true, precision: 3 })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => [
    check(
      'signing_keys_chave_publica_tamanho',
      sql`octet_length(${t.chavePublica}) = ${bytesDaChave}`,
    ),
    check('signing_keys_key_id_formato', sql`${t.keyId} ~ ${formatoDoKeyId}`),
    // O key_id é derivado da chave: uma linha não publica uma chave sob o id de outra.
    check(
      'signing_keys_key_id_da_chave',
      sql`${t.keyId} = left(encode(sha256(${t.chavePublica}), 'hex'), ${caracteresDoKeyId})`,
    ),
  ],
);

/** Lance aceito: um elo da hash chain do lote, assinado (specs/007 §Dados, specs/008). */
export const bids = pgTable(
  'bids',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    loteId: uuid('lote_id').notNull(),
    seq: integer('seq').notNull(),
    licitanteId: uuid('licitante_id').notNull(),
    pseudonimo: text('pseudonimo').notNull(),
    valorCentavos: bigint('valor_centavos', { mode: 'number' }).notNull(),
    // Sem default: é o `agora(tx)` lido uma vez na transação do lance e assinado (specs/008).
    criadoEm: timestamp('criado_em', { withTimezone: true, precision: 3 }).notNull(),
    hashAnterior: bytea('hash_anterior').notNull(),
    hash: bytea('hash').notNull(),
    assinatura: bytea('assinatura').notNull(),
    keyId: text('key_id')
      .notNull()
      .references(() => signingKeys.keyId),
    // Obrigatória: o lance exige o header Idempotency-Key (specs/007 §Idempotência).
    idempotencyKey: uuid('idempotency_key').notNull(),
  },
  (t) => [
    // Seq contígua por lote; o índice do unique também serve `where lote_id = ? order by seq
    // desc` (varredura reversa), o histórico paginado e a cadeia da auditoria.
    unique('bids_lote_id_seq_unique').on(t.loteId, t.seq),
    unique('bids_licitante_id_idempotency_key_unique').on(t.licitanteId, t.idempotencyKey),
    // GET /api/me/lances (specs/007): lotes em que o usuário deu lance.
    index('bids_licitante_id_lote_id_idx').on(t.licitanteId, t.loteId),
    check('bids_seq_positivo', sql`${t.seq} >= 1`),
    check('bids_valor_faixa', sql`${t.valorCentavos} between ${minimo} and ${maximo}`),
    check('bids_hash_anterior_tamanho', sql`octet_length(${t.hashAnterior}) = ${bytesDoHash}`),
    check('bids_hash_tamanho', sql`octet_length(${t.hash}) = ${bytesDoHash}`),
    check('bids_assinatura_tamanho', sql`octet_length(${t.assinatura}) = ${bytesDaAssinatura}`),
    check('bids_key_id_formato', sql`${t.keyId} ~ ${formatoDoKeyId}`),
    check('bids_pseudonimo_formato', sql`${t.pseudonimo} ~ ${formatoDoPseudonimo}`),
  ],
);

/** Selo do lote encerrado ou cancelado (specs/008 §Técnica), gravado por `lances.selar`. */
export const lotSeals = pgTable(
  'lot_seals',
  {
    loteId: uuid('lote_id').primaryKey(),
    status: text('status').notNull(),
    totalLances: integer('total_lances').notNull(),
    hashFinal: bytea('hash_final').notNull(),
    // Nulos em lote cancelado ou sem lance (specs/008 §Forma canônica).
    vencedorPseudonimo: text('vencedor_pseudonimo'),
    valorArremateCentavos: bigint('valor_arremate_centavos', { mode: 'number' }),
    seladoEm: timestamp('selado_em', { withTimezone: true, precision: 3 }).notNull(),
    assinatura: bytea('assinatura').notNull(),
    keyId: text('key_id')
      .notNull()
      .references(() => signingKeys.keyId),
  },
  (t) => [
    check('lot_seals_status_valido', sql`${t.status} in (${statusDoSelo})`),
    check('lot_seals_total_lances_nao_negativo', sql`${t.totalLances} >= 0`),
    check('lot_seals_hash_final_tamanho', sql`octet_length(${t.hashFinal}) = ${bytesDoHash}`),
    check(
      'lot_seals_assinatura_tamanho',
      sql`octet_length(${t.assinatura}) = ${bytesDaAssinatura}`,
    ),
    check('lot_seals_key_id_formato', sql`${t.keyId} ~ ${formatoDoKeyId}`),
    // NULL passa (CHECK com NULL não falha): lote sem vencedor.
    check(
      'lot_seals_vencedor_pseudonimo_formato',
      sql`${t.vencedorPseudonimo} ~ ${formatoDoPseudonimo}`,
    ),
    check(
      'lot_seals_valor_arremate_faixa',
      sql`${t.valorArremateCentavos} is null or ${t.valorArremateCentavos} between ${minimo} and ${maximo}`,
    ),
    // Vencedor e arremate andam juntos e existem só em lote encerrado com lance.
    check(
      'lot_seals_vencedor_com_arremate',
      sql`(${t.vencedorPseudonimo} is null) = (${t.valorArremateCentavos} is null)`,
    ),
    check(
      'lot_seals_arremate_so_se_vendido',
      sql`(${t.valorArremateCentavos} is not null) = (${t.status} = 'encerrado' and ${t.totalLances} > 0)`,
    ),
  ],
);
