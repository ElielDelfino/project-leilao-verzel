// Entradas de POST /api/lotes/{id}/lances (openapi.yaml: LanceEntrada, IdempotencyKey, Uuid;
// specs/007 §Ordem das verificações, passo 4). Objeto estrito: campo desconhecido → 422.
import { z } from 'zod';

/** `valorCentavos` inteiro de 1 a 2^53 − 1 (z.int() já recusa fora do inteiro seguro). */
export const esquemaDoLance = z.strictObject({
  valorCentavos: z.int().min(1).max(Number.MAX_SAFE_INTEGER),
});
export type DadosDoLance = z.infer<typeof esquemaDoLance>;

/** Header Idempotency-Key: UUID; ausente, repetido (lista) ou outro formato → 422. */
export const esquemaDaChaveDoLance = z.uuid();

/** Id do lote na URL: o que não é UUID responde 404, como lote inexistente (ADR 0031 D11). */
export const UUID_DO_LOTE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
