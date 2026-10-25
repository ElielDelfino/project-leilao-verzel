// Depósito digitado em reais (pt-BR) → centavos inteiros, sem float (ADR 0001, specs/004).
// Limites do contrato (DepositoEntrada): R$ 1,00 a R$ 100.000,00.
export const DEPOSITO_MINIMO_CENTAVOS = 100;
export const DEPOSITO_MAXIMO_CENTAVOS = 10_000_000;

// Inteiro com ou sem separador de milhar ("1.234" ou "1234") e 1 ou 2 casas depois da vírgula.
const FORMATO = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/;
// R$ 100.000 tem 6 dígitos; mais que isso já estoura o limite sem precisar converter.
const MAXIMO_DIGITOS_DE_REAIS = 7;

/**
 * Converte o texto digitado ("1.234,56") em centavos inteiros. Devolve null se o formato for
 * inválido ou o valor ficar fora de R$ 1,00 a R$ 100.000,00. Só aritmética de inteiros.
 */
export function reaisParaCentavos(texto: string): number | null {
  const partes = FORMATO.exec(texto.trim());
  if (!partes) return null;

  const reais = (partes[1] ?? '').replaceAll('.', '');
  if (reais.length > MAXIMO_DIGITOS_DE_REAIS) return null;
  const centavosDigitados = (partes[2] ?? '').padEnd(2, '0');

  const centavos = Number(reais) * 100 + Number(centavosDigitados);
  if (centavos < DEPOSITO_MINIMO_CENTAVOS || centavos > DEPOSITO_MAXIMO_CENTAVOS) return null;
  return centavos;
}
