// Fixtures por SQL dos testes de comprovante (tarefa 109): um recibo gravado direto em `receipts`,
// com lote e chave reais (FKs imediatas). `receipts` é append-only: o recibo fica para sempre,
// por isso cada teste usa o próprio leiloeiro, os próprios licitantes e códigos únicos.
import { randomBytes } from 'node:crypto';

import type pg from 'pg';

import { inserirChaveDeTeste } from '../../../helpers/lance-por-sql.js';
import { inserirLote } from '../../../helpers/lotes-por-sql.js';

const ALFABETO_BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const CARACTERES_DO_CODIGO = 16;
const BYTES_DO_HASH = 32;
const BYTES_DA_ASSINATURA = 64;
const PSEUDONIMO_DE_TESTE = 'Licitante #3fa9c1';

export interface ReciboSemeado {
  readonly codigo: string;
  readonly loteId: string;
  readonly snapshotId: string;
  readonly valorCentavos: number;
  readonly hashFinalHex: string;
  readonly assinaturaBase64url: string;
  readonly keyId: string;
}

export function codigoNovo(): string {
  return Array.from(randomBytes(CARACTERES_DO_CODIGO), (b) => ALFABETO_BASE62[b % 62]).join('');
}

/** Lote + recibo do vencedor, emitido em `emitidoEm` (milissegundos desde a época). */
export async function semearRecibo(
  pool: pg.Pool,
  dados: {
    readonly leiloeiroId: string;
    readonly vencedorId: string;
    readonly valorCentavos: number;
    readonly emitidoEm: number;
  },
): Promise<ReciboSemeado> {
  const lote = await inserirLote(pool, dados.leiloeiroId, { carta_nome: 'Black Lotus' });
  const keyId = await inserirChaveDeTeste(pool);
  const codigo = codigoNovo();
  const hash = randomBytes(BYTES_DO_HASH);
  const assinatura = randomBytes(BYTES_DA_ASSINATURA);
  await pool.query(
    `insert into receipts (lote_id, codigo_publico, vencedor_id, vencedor_pseudonimo,
       valor_centavos, hash_final, assinatura_selo, key_id, selado_em, emitido_em)
     values ($1, $2, $3, $4, $5::bigint, $6, $7, $8, $9, $9)`,
    [
      lote.id,
      codigo,
      dados.vencedorId,
      PSEUDONIMO_DE_TESTE,
      dados.valorCentavos,
      hash,
      assinatura,
      keyId,
      new Date(dados.emitidoEm),
    ],
  );
  return {
    codigo,
    loteId: lote.id,
    snapshotId: lote.snapshotId,
    valorCentavos: dados.valorCentavos,
    hashFinalHex: hash.toString('hex'),
    assinaturaBase64url: assinatura.toString('base64url'),
    keyId,
  };
}
