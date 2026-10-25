// Leituras de `receipts` para o comprovante público e "Meus arremates" (tarefa 109). Colunas
// EXPLÍCITAS (lista branca): `vencedor_id` e `id` nunca são selecionados nas rotas públicas.
import { count, desc, eq } from 'drizzle-orm';

import type { BancoDrizzle } from '../../../db/banco.js';
import { receipts } from '../schema.js';

export interface LinhaDoComprovante {
  readonly codigoPublico: string;
  readonly loteId: string;
  readonly vencedorPseudonimo: string;
  readonly valorCentavos: number;
  readonly hashFinal: Buffer;
  readonly assinaturaSelo: Buffer;
  readonly keyId: string;
  readonly seladoEm: Date;
  readonly emitidoEm: Date;
}

export interface LinhaDoArremate {
  readonly codigoPublico: string;
  readonly loteId: string;
  readonly valorCentavos: number;
  readonly emitidoEm: Date;
}

export async function buscarPorCodigo(
  db: BancoDrizzle,
  codigoPublico: string,
): Promise<LinhaDoComprovante | undefined> {
  const [linha] = await db
    .select({
      codigoPublico: receipts.codigoPublico,
      loteId: receipts.loteId,
      vencedorPseudonimo: receipts.vencedorPseudonimo,
      valorCentavos: receipts.valorCentavos,
      hashFinal: receipts.hashFinal,
      assinaturaSelo: receipts.assinaturaSelo,
      keyId: receipts.keyId,
      seladoEm: receipts.seladoEm,
      emitidoEm: receipts.emitidoEm,
    })
    .from(receipts)
    .where(eq(receipts.codigoPublico, codigoPublico))
    .limit(1);
  return linha;
}

export async function contarDoVencedor(db: BancoDrizzle, vencedorId: string): Promise<number> {
  const [linha] = await db
    .select({ total: count() })
    .from(receipts)
    .where(eq(receipts.vencedorId, vencedorId));
  return linha?.total ?? 0;
}

/** Do mais recente ao mais antigo (índice receipts_vencedor_id_emitido_em_id_idx). */
export function listarDoVencedor(
  db: BancoDrizzle,
  vencedorId: string,
  pagina: { readonly limite: number; readonly deslocamento: number },
): Promise<LinhaDoArremate[]> {
  return db
    .select({
      codigoPublico: receipts.codigoPublico,
      loteId: receipts.loteId,
      valorCentavos: receipts.valorCentavos,
      emitidoEm: receipts.emitidoEm,
    })
    .from(receipts)
    .where(eq(receipts.vencedorId, vencedorId))
    .orderBy(desc(receipts.emitidoEm), desc(receipts.id))
    .limit(pagina.limite)
    .offset(pagina.deslocamento);
}
