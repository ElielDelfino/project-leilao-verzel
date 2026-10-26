export type Aba = 'lances' | 'arrematados';

export interface EstadoDaTela {
  aba: Aba;
  pagina: number;
}

export const ABAS: readonly Aba[] = ['lances', 'arrematados'];
/** A API aceita `pagina` de 1 a 500 (openapi); acima disso responderia 422. */
export const PAGINA_MAXIMA = 500;

/** Valor ausente ou inválido cai no padrão: aba "Meus lances", página 1. */
export function lerEstado(params: URLSearchParams): EstadoDaTela {
  const aba = ABAS.find((a) => a === params.get('aba')) ?? 'lances';
  const numero = Number(params.get('pagina'));
  const pagina = Number.isInteger(numero) && numero >= 1 ? Math.min(numero, PAGINA_MAXIMA) : 1;
  return { aba, pagina };
}

/** Só grava o que difere do padrão, para a URL ficar curta. */
export function escreverEstado({ aba, pagina }: EstadoDaTela): URLSearchParams {
  const params = new URLSearchParams();
  if (aba !== 'lances') params.set('aba', aba);
  if (pagina > 1) params.set('pagina', String(pagina));
  return params;
}
