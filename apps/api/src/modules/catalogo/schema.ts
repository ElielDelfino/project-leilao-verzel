// Tabela do módulo catalogo (specs/005 §Dados, tarefa 051). Migration: 0002_catalogo_lotes.
// O snapshot é imutável (specs/005 §Snapshot): o papel da API só tem SELECT e INSERT nele
// (ADR 0026). O GRANT fica no SQL da migration. Retenção permanente: faz parte do lote e do
// comprovante.
import { sql } from 'drizzle-orm';
import { check, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { bytea } from '../../db/colunas.js';

/** `imagem_sha256` é o SHA-256 dos bytes da imagem (32 bytes); vira o ETag de /api/imagens. */
export const BYTES_DO_SHA256 = 32;

/**
 * Tipos de imagem aceitos no download (specs/005 §Snapshot). O `imagem_mime` vira o Content-Type
 * de `GET /api/imagens/{snapshotId}`, então o banco não aceita outro valor.
 */
export const MIMES_DE_IMAGEM = ['image/jpeg', 'image/png'] as const;

const mimesAceitos = sql.raw(MIMES_DE_IMAGEM.map((mime) => `'${mime}'`).join(', '));

export const cardSnapshots = pgTable(
  'card_snapshots',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    // Sem unique: cada lote grava o próprio snapshot, ainda que da mesma carta.
    scryfallId: uuid('scryfall_id').notNull(),
    nome: text('nome').notNull(),
    colecao: text('colecao').notNull(),
    raridade: text('raridade').notNull(),
    tipo: text('tipo').notNull(),
    // Nulos como no contrato (`Carta` do openapi.yaml): há cartas sem texto ou sem artista.
    textoOracle: text('texto_oracle'),
    artista: text('artista'),
    dados: jsonb('dados').notNull(),
    // Carta sem imagem `normal` não gera snapshot (422 no preparo).
    imagem: bytea('imagem').notNull(),
    imagemMime: text('imagem_mime').notNull(),
    imagemSha256: bytea('imagem_sha256').notNull(),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'card_snapshots_imagem_sha256_tamanho',
      sql`octet_length(${t.imagemSha256}) = ${sql.raw(String(BYTES_DO_SHA256))}`,
    ),
    check('card_snapshots_imagem_mime_valido', sql`${t.imagemMime} in (${mimesAceitos})`),
  ],
);
