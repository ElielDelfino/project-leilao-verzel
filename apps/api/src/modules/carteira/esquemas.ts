// Entradas da tag carteira (openapi.yaml: DepositoEntrada, IdempotencyKey, Pagina; specs/004
// RF-03, RF-04). Objetos estritos: campo desconhecido → 422 DADOS_INVALIDOS.
import { z } from 'zod';

/** R$ 1,00 a R$ 100.000,00 por operação, em centavos (specs/004 RF-03). */
export const DEPOSITO_MINIMO = 100;
export const DEPOSITO_MAXIMO = 10_000_000;

export const esquemaDoDeposito = z.strictObject({
  valorCentavos: z.int().min(DEPOSITO_MINIMO).max(DEPOSITO_MAXIMO),
});
export type DadosDoDeposito = z.infer<typeof esquemaDoDeposito>;

/** Header Idempotency-Key: UUID; ausente, repetido (lista) ou outro formato → 422. */
export const esquemaDaChaveDeIdempotencia = z.uuid();

/**
 * `pagina` da query: inteiro decimal ≥ 1, sem zeros à esquerda e seguro; ausente → 1. Repetida
 * (o Fastify entrega uma lista), vazia, 0, negativa ou não inteira → 422 (specs/004).
 */
export const esquemaDaPagina = z
  .string()
  .regex(/^[1-9]\d*$/)
  .transform(Number)
  .pipe(z.int().min(1))
  .optional()
  .transform((pagina) => pagina ?? 1);
