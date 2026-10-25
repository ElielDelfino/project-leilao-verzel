// Entradas de POST /api/lotes/{id}/lances (openapi.yaml: LanceEntrada, IdempotencyKey, Uuid;
// specs/007 §Ordem das verificações, passo 4) e o `pagina` das duas listas (PaginaLimitada).
// Objeto estrito: campo desconhecido → 422.
import { HttpStatus, type PipeTransform } from '@nestjs/common';
import { z } from 'zod';

import { ErroApi } from '../../common/erros/erro-api.js';

/** `valorCentavos` inteiro de 1 a 2^53 − 1 (z.int() já recusa fora do inteiro seguro). */
export const esquemaDoLance = z.strictObject({
  valorCentavos: z.int().min(1).max(Number.MAX_SAFE_INTEGER),
});
export type DadosDoLance = z.infer<typeof esquemaDoLance>;

/** Header Idempotency-Key: UUID; ausente, repetido (lista) ou outro formato → 422. */
export const esquemaDaChaveDoLance = z.uuid();

/** Id do lote na URL: o que não é UUID responde 404, como lote inexistente (ADR 0031 D11). */
export const UUID_DO_LOTE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lances por página do histórico público e lotes por página de GET /api/me/lances (specs/007). */
export const LANCES_POR_PAGINA = 50;
export const LOTES_DO_USUARIO_POR_PAGINA = 24;

/** Teto de `pagina` (openapi.yaml: PaginaLimitada); evita OFFSET sem limite. */
export const PAGINA_MAXIMA = 500;

/** `pagina`: inteiro decimal de 1 a 500, sem zeros à esquerda; ausente → 1 (repetida → 422). */
export const esquemaDaPaginaDeLances = z
  .string()
  .regex(/^[1-9]\d{0,2}$/)
  .transform(Number)
  .pipe(z.int().min(1).max(PAGINA_MAXIMA))
  .optional()
  .transform((pagina) => pagina ?? 1);

/** Pipe do query `pagina`: valor fora do contrato → 422 DADOS_INVALIDOS com `detalhes.campo`. */
export class PipeDaPaginaDeLances implements PipeTransform<unknown, number> {
  transform(valor: unknown): number {
    const resultado = esquemaDaPaginaDeLances.safeParse(valor);
    if (!resultado.success) {
      throw new ErroApi({
        codigo: 'DADOS_INVALIDOS',
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        mensagem: 'Dados inválidos.',
        detalhes: { campo: 'pagina' },
      });
    }
    return resultado.data;
  }
}
