// Filtro de preço da vitrine: texto em reais pt-BR ↔ centavos inteiros, sem float (ADR 0001).
export const PRECO_MAXIMO_CENTAVOS = 10_000_000_000;
export const TEXTO_PRECO_INVALIDO = 'Informe um valor entre R$ 0,00 e R$ 100.000.000,00.';
export const TEXTO_MAXIMO_MENOR_QUE_MINIMO = 'O preço máximo deve ser maior ou igual ao mínimo.';

const FORMATO = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/;
const MAXIMO_DIGITOS_DE_REAIS = 9;

/** "1.234,56" → 123456; null se mal formado ou fora de R$ 0,00 a R$ 100.000.000,00. */
export function precoParaCentavos(texto: string): number | null {
  const partes = FORMATO.exec(texto.trim());
  if (!partes) return null;
  const reais = (partes[1] ?? '').replaceAll('.', '');
  if (reais.length > MAXIMO_DIGITOS_DE_REAIS) return null;
  const centavos = Number(reais) * 100 + Number((partes[2] ?? '').padEnd(2, '0'));
  return centavos > PRECO_MAXIMO_CENTAVOS ? null : centavos;
}

/** 123456 → "1.234,56" (para preencher o campo a partir da URL). */
export function centavosParaTexto(centavos: number): string {
  const reais = Math.trunc(centavos / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${reais},${(centavos % 100).toString().padStart(2, '0')}`;
}
