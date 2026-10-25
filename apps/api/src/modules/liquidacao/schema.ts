// Tabela do módulo liquidacao (specs/010 §Dados, D8 do relatório f4-spec-guardian-1; tarefa 102).
// Migration: 0005_receipts_liquidacao. `receipts` é append-only (specs/008 §Técnica): o
// comprovante é emitido uma vez, na transação de encerramento, e nunca muda.
//
// O que fica só no SQL da migration (o drizzle-kit não gera ou a fronteira de módulos impede):
// - FKs lote_id → lots(id), vencedor_id → users(id) e key_id → signing_keys(key_id), sem
//   CASCADE: liquidacao não importa lotes, identidade nem lances (specs/001 §Módulos);
// - os triggers append-only (public.impedir_alteracao(), linha e BEFORE TRUNCATE);
// - o GRANT ao papel da API (ADR 0026): só SELECT e INSERT.
// O índice único parcial (lote_id, tipo) do ledger da mesma migration é de carteira/schema.ts.
//
// key_id e selado_em são copiados do selo na emissão (D8): liquidacao não lê lot_seals (dono:
// lances), e o comprovante precisa deles para ser verificado sozinho (specs/011).
import { sql } from 'drizzle-orm';
import { bigint, check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { bytea } from '../../db/colunas.js';

/** Arremate mínimo e máximo em centavos, os mesmos de `bids` (ADR 0001, specs/006). */
export const CENTAVOS_MINIMO_DO_ARREMATE = 100;
export const CENTAVOS_MAXIMO_DO_ARREMATE = Number.MAX_SAFE_INTEGER;

/** Código público do comprovante: 16 caracteres base62 (specs/011). */
export const FORMATO_DO_CODIGO_PUBLICO = '^[0-9A-Za-z]{16}$';

/** Pseudônimo público, igual ao de `bids` e `lot_seals` (specs/008 §Técnica). */
export const FORMATO_DO_PSEUDONIMO_DO_VENCEDOR = '^Licitante #[0-9a-f]{6}$';

/** Tamanhos em bytes: SHA-256 e assinatura Ed25519; key_id com 16 hex minúsculos (specs/008). */
export const BYTES_DO_HASH_FINAL = 32;
export const BYTES_DA_ASSINATURA_DO_SELO = 64;
const FORMATO_DO_KEY_ID = '^[0-9a-f]{16}$';

const minimo = sql.raw(String(CENTAVOS_MINIMO_DO_ARREMATE));
const maximo = sql.raw(String(CENTAVOS_MAXIMO_DO_ARREMATE));
const bytesDoHash = sql.raw(String(BYTES_DO_HASH_FINAL));
const bytesDaAssinatura = sql.raw(String(BYTES_DA_ASSINATURA_DO_SELO));
const formatoDoCodigo = sql.raw(`'${FORMATO_DO_CODIGO_PUBLICO}'`);
const formatoDoPseudonimo = sql.raw(`'${FORMATO_DO_PSEUDONIMO_DO_VENCEDOR}'`);
const formatoDoKeyId = sql.raw(`'${FORMATO_DO_KEY_ID}'`);

/** Comprovante de arremate: um por lote vendido (specs/010 §Dados, specs/011). */
export const receipts = pgTable(
  'receipts',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    loteId: uuid('lote_id').notNull().unique(),
    codigoPublico: text('codigo_publico').notNull().unique(),
    vencedorId: uuid('vencedor_id').notNull(),
    vencedorPseudonimo: text('vencedor_pseudonimo').notNull(),
    valorCentavos: bigint('valor_centavos', { mode: 'number' }).notNull(),
    hashFinal: bytea('hash_final').notNull(),
    assinaturaSelo: bytea('assinatura_selo').notNull(),
    keyId: text('key_id').notNull(),
    // O instante assinado no selo, com as mesmas 3 casas de lot_seals (specs/008).
    seladoEm: timestamp('selado_em', { withTimezone: true, precision: 3 }).notNull(),
    // 3 casas: o cursor de GET /api/me/arremates (emitido_em, id) volta da API em milissegundos.
    emitidoEm: timestamp('emitido_em', { withTimezone: true, precision: 3 })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => [
    // GET /api/me/arremates: os comprovantes do usuário, do mais recente ao mais antigo.
    // NULLS FIRST é o padrão do DESC: casa com `order by emitido_em desc, id desc`.
    index('receipts_vencedor_id_emitido_em_id_idx').on(
      t.vencedorId,
      t.emitidoEm.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
    check('receipts_codigo_publico_formato', sql`${t.codigoPublico} ~ ${formatoDoCodigo}`),
    check(
      'receipts_vencedor_pseudonimo_formato',
      sql`${t.vencedorPseudonimo} ~ ${formatoDoPseudonimo}`,
    ),
    check('receipts_valor_faixa', sql`${t.valorCentavos} between ${minimo} and ${maximo}`),
    check('receipts_hash_final_tamanho', sql`octet_length(${t.hashFinal}) = ${bytesDoHash}`),
    check(
      'receipts_assinatura_selo_tamanho',
      sql`octet_length(${t.assinaturaSelo}) = ${bytesDaAssinatura}`,
    ),
    check('receipts_key_id_formato', sql`${t.keyId} ~ ${formatoDoKeyId}`),
  ],
);
