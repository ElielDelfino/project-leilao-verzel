// Dinheiro trafega em centavos inteiros (ADR 0001) e é exibido em BRL, pt-BR (specs/012).
const formatoBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

const CENTAVOS_POR_REAL = 100n;

/**
 * Formata centavos inteiros como moeda (ex.: 123456 → "R$ 1.234,56").
 * Monta a string decimal a partir de inteiros para não passar por float.
 * Lança RangeError se o valor não for um inteiro seguro.
 */
export function formatarCentavos(centavos: number): string {
  if (!Number.isSafeInteger(centavos)) {
    throw new RangeError(`Valor em centavos inválido: ${centavos}`);
  }
  const absoluto = BigInt(Math.abs(centavos));
  const reais = absoluto / CENTAVOS_POR_REAL;
  const resto = (absoluto % CENTAVOS_POR_REAL).toString().padStart(2, '0');
  const sinal = centavos < 0 ? '-' : '';
  // "<sinal><inteiro>.<2 dígitos>" é um literal numérico válido; o TS não infere isso do template.
  const decimal = `${sinal}${reais}.${resto}` as Intl.StringNumericLiteral;
  return formatoBRL.format(decimal);
}
