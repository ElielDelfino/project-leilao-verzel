// Validação de corpo, parâmetros e headers com Zod (specs/003 §Ordem das verificações, etapa 4).
// Uso: `@Body(new PipeZod(esquema)) corpo: z.infer<typeof esquema>`. Use z.strictObject nos
// objetos: campo desconhecido também é 422 DADOS_INVALIDOS (specs/003 §Comportamento).
import { HttpStatus, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

import { ErroApi } from '../erros/erro-api.js';

/** Mesma mensagem fixa dos 4xx do framework (traducao.ts): nunca repete o que foi recebido. */
const MENSAGEM = 'Requisição inválida.';

export class PipeZod<E extends z.ZodType> implements PipeTransform<unknown, z.output<E>> {
  readonly #esquema: E;

  constructor(esquema: E) {
    this.#esquema = esquema;
  }

  transform(valor: unknown): z.output<E> {
    const resultado = this.#esquema.safeParse(valor);
    if (!resultado.success) {
      throw new ErroApi({
        codigo: 'DADOS_INVALIDOS',
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        mensagem: MENSAGEM,
      });
    }
    return resultado.data;
  }
}
