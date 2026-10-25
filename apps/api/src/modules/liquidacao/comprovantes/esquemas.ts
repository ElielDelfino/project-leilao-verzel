// Query `pagina` de GET /api/me/arremates (openapi.yaml: PaginaLimitada): inteiro decimal de 1 a
// 500, sem zeros à esquerda; ausente → 1; fora disso → 422 DADOS_INVALIDOS com `detalhes.campo`.
import { HttpStatus, type PipeTransform } from '@nestjs/common';
import { z } from 'zod';

import { ErroApi } from '../../../common/erros/erro-api.js';

export const PAGINA_MAXIMA = 500;

const esquemaDaPagina = z
  .string()
  .regex(/^[1-9]\d{0,2}$/)
  .transform(Number)
  .pipe(z.int().min(1).max(PAGINA_MAXIMA))
  .optional()
  .transform((pagina) => pagina ?? 1);

export class PipeDaPagina implements PipeTransform<unknown, number> {
  transform(valor: unknown): number {
    const resultado = esquemaDaPagina.safeParse(valor);
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
