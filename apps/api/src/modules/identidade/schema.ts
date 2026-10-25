// Tabelas do módulo identidade (specs/003 §Dados, tarefa 037). Migration: 0001_identidade_carteira.
// Privilégios do papel da API (matriz D3 da tarefa 036): users SELECT, INSERT; refresh_tokens
// SELECT, INSERT, UPDATE, DELETE. Os GRANTs ficam no SQL da migration.
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { bytea, citext } from '../../db/colunas.js';
import { papelUsuario } from '../../db/schema.js';

/** Limites de users (specs/003 §Dados e D12 da tarefa 036: nome de 2 a 80; e-mail até 254). */
export const NOME_MINIMO = 2;
export const NOME_MAXIMO = 80;
export const EMAIL_MAXIMO = 254;

/** O refresh token é guardado só como SHA-256 (32 bytes). */
export const BYTES_DO_HASH_DO_TOKEN = 32;

export const users = pgTable(
  'users',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    nome: text('nome').notNull(),
    email: citext('email').notNull().unique(),
    senhaHash: text('senha_hash').notNull(),
    papel: papelUsuario('papel').notNull(),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'users_nome_tamanho',
      sql`char_length(${t.nome}) between ${sql.raw(String(NOME_MINIMO))} and ${sql.raw(String(NOME_MAXIMO))}`,
    ),
    check('users_email_tamanho', sql`char_length(${t.email}) <= ${sql.raw(String(EMAIL_MAXIMO))}`),
  ],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    // Sem CASCADE: usuários não são excluídos (ADR 0001).
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    familiaId: uuid('familia_id').notNull(),
    tokenHash: bytea('token_hash').notNull().unique(),
    expiraEm: timestamp('expira_em', { withTimezone: true }).notNull(),
    revogadoEm: timestamp('revogado_em', { withTimezone: true }),
    // SET NULL: o expurgo diário (specs/003 §Dados) apaga um token sem esbarrar no anterior da
    // rotação, que só perde a referência.
    substituidoPor: uuid('substituido_por').references((): AnyPgColumn => refreshTokens.id, {
      onDelete: 'set null',
    }),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Revogar a família inteira ao detectar reuso (specs/003 §Comportamento).
    index('refresh_tokens_familia_id_idx').on(t.familiaId),
    // Índices das FKs: o expurgo diário (specs/003 §Dados) apaga linhas referenciadas por
    // substituido_por, e a FK de user_id é checada a cada linha de users.
    index('refresh_tokens_user_id_idx').on(t.userId),
    index('refresh_tokens_substituido_por_idx').on(t.substituidoPor),
    check(
      'refresh_tokens_token_hash_tamanho',
      sql`octet_length(${t.tokenHash}) = ${sql.raw(String(BYTES_DO_HASH_DO_TOKEN))}`,
    ),
  ],
);
