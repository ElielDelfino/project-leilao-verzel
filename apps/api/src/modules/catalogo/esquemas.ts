// Entradas da tag catalogo e imagens (openapi.yaml: catalogoBuscarCartas, imagemDoSnapshot;
// specs/005 §Busca). Erro de campo sai em `detalhes.campo` (422 DADOS_INVALIDOS).
import { HttpStatus, type PipeTransform } from '@nestjs/common';
import { z } from 'zod';

import { ErroApi } from '../../common/erros/erro-api.js';

/** Cartas por página nossa e o teto de `pagina` (specs/005 §Busca). */
export const CARTAS_POR_PAGINA = 25;
export const PAGINA_MAXIMA = 500;
const TAMANHO_MAXIMO_DE_Q = 200;

export type CampoDaBusca = 'q' | 'pagina';

/** `q`: 1 a 200 caracteres, sem espaços nas pontas; repetido (lista) também é inválido. */
export const esquemaDoQ = z
  .string()
  .min(1)
  .max(TAMANHO_MAXIMO_DE_Q)
  .refine((q) => q.trim() === q);

/** `pagina`: inteiro decimal de 1 a 500, sem zeros à esquerda; ausente → 1. */
export const esquemaDaPaginaDaBusca = z
  .string()
  .regex(/^[1-9]\d{0,2}$/)
  .transform(Number)
  .pipe(z.int().min(1).max(PAGINA_MAXIMA))
  .optional()
  .transform((pagina) => pagina ?? 1);

export function dadosInvalidos(campo: CampoDaBusca): ErroApi {
  return new ErroApi({
    codigo: 'DADOS_INVALIDOS',
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    mensagem: 'Dados inválidos.',
    detalhes: { campo },
  });
}

/** Como o PipeZod, mas o 422 leva `detalhes.campo` (specs/005 §Busca). */
export class PipeDoCampo<E extends z.ZodType> implements PipeTransform<unknown, z.output<E>> {
  readonly #esquema: E;
  readonly #campo: CampoDaBusca;

  constructor(esquema: E, campo: CampoDaBusca) {
    this.#esquema = esquema;
    this.#campo = campo;
  }

  transform(valor: unknown): z.output<E> {
    const resultado = this.#esquema.safeParse(valor);
    if (!resultado.success) throw dadosInvalidos(this.#campo);
    return resultado.data;
  }
}
