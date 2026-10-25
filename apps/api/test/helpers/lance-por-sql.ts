// Fixtures por SQL de lote e lance reais (tarefa 094), para testes de integração que gravam no
// ledger com `lote_id` e `lance_id`: a migration 0003 tem FKs imediatas para `lots` e `bids` (D9 da
// ADR 0031). A chave é gerada na hora e só vale no teste; hash e assinatura são bytes quaisquer
// com o tamanho que os CHECKs de `bids` exigem (nada aqui é verificado criptograficamente).
import { createHash, randomBytes, randomUUID } from 'node:crypto';

import type pg from 'pg';

import { inserirLote, inserirUsuario } from './lotes-por-sql.js';

const BYTES_DO_HASH = 32;
const BYTES_DA_ASSINATURA = 64;
const BYTES_DA_CHAVE_PUBLICA = 32;
const CARACTERES_DO_KEY_ID = 16;
const VALOR_MINIMO_DO_LANCE = 100;
// Formato da specs/008: "Licitante #" + 6 hex minúsculos (CHECK em `bids.pseudonimo`).
const PSEUDONIMO_DE_TESTE = 'Licitante #3fa9c1';

export interface ReferenciaDeLance {
  readonly loteId: string;
  readonly lanceId: string;
}

/** Registra uma chave pública aleatória em `signing_keys` e devolve o `key_id` derivado dela. */
export async function inserirChaveDeTeste(pool: pg.Pool): Promise<string> {
  const chave = randomBytes(BYTES_DA_CHAVE_PUBLICA);
  const keyId = createHash('sha256').update(chave).digest('hex').slice(0, CARACTERES_DO_KEY_ID);
  await pool.query(
    `insert into signing_keys (key_id, chave_publica) values ($1, $2)
     on conflict (key_id) do nothing`,
    [keyId, chave],
  );
  return keyId;
}

/** Lance com seq 1 num lote existente. Valores de hash e assinatura são só de formato. */
export async function inserirLance(
  pool: pg.Pool,
  loteId: string,
  licitanteId: string,
  keyId: string,
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into bids (lote_id, seq, licitante_id, pseudonimo, valor_centavos, criado_em,
       hash_anterior, hash, assinatura, key_id, idempotency_key)
     values ($1, 1, $2, $3, $4::bigint, now(), $5, $6, $7, $8, $9)
     returning id`,
    [
      loteId,
      licitanteId,
      PSEUDONIMO_DE_TESTE,
      VALOR_MINIMO_DO_LANCE,
      Buffer.alloc(BYTES_DO_HASH, 1),
      randomBytes(BYTES_DO_HASH),
      randomBytes(BYTES_DA_ASSINATURA),
      keyId,
      randomUUID(),
    ],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('insert em bids não devolveu o id');
  return id;
}

/**
 * Cria leiloeiro, lote ao vivo, licitante autor, chave de teste e um lance real, e devolve
 * `{loteId, lanceId}` para o ledger referenciar. Cada chamada cria um lote e um lance novos.
 */
export async function criarLoteELance(pool: pg.Pool): Promise<ReferenciaDeLance> {
  const leiloeiro = await inserirUsuario(pool, 'leiloeiro');
  const autor = await inserirUsuario(pool, 'licitante');
  const lote = await inserirLote(pool, leiloeiro.id);
  const keyId = await inserirChaveDeTeste(pool);
  const lanceId = await inserirLance(pool, lote.id, autor.id, keyId);
  return { loteId: lote.id, lanceId };
}
