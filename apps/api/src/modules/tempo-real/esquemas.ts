// Validação dos payloads cliente → servidor (asyncapi.yaml, schema `LoteRef`): `loteId` UUID e
// nenhum campo desconhecido.
import { z } from 'zod';

export const esquemaDeLoteRef = z.strictObject({ loteId: z.uuid() });

/**
 * `loteId` do payload de `entrar_lote` e `sair_lote`, em minúsculas (como o Postgres o devolve e
 * os eventos o publicam: o room `lote:{id}` é um só); `undefined` se o payload for inválido.
 */
export function lerLoteRef(payload: unknown): string | undefined {
  const resultado = esquemaDeLoteRef.safeParse(payload);
  return resultado.success ? resultado.data.loteId.toLowerCase() : undefined;
}
