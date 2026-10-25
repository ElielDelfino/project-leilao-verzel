// Valor do lance digitado em reais (pt-BR) ↔ centavos inteiros, sem float (ADR 0001, specs/012).
// Limite do contrato (LanceEntrada): 1 a Number.MAX_SAFE_INTEGER centavos.
const MAXIMO_CENTAVOS = BigInt(Number.MAX_SAFE_INTEGER);

// Inteiro com ou sem separador de milhar e 1 ou 2 casas depois da vírgula.
const FORMATO = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/;

/** "150,00" → 15000. Devolve null se o formato for inválido, zero ou acima do limite. Usa BigInt. */
export function reaisParaCentavosDoLance(texto: string): number | null {
  const partes = FORMATO.exec(texto.trim());
  if (!partes) return null;

  const reais = (partes[1] ?? '').replaceAll('.', '');
  const centavosDigitados = (partes[2] ?? '').padEnd(2, '0');
  const centavos = BigInt(reais) * 100n + BigInt(centavosDigitados);
  if (centavos < 1n || centavos > MAXIMO_CENTAVOS) return null;
  return Number(centavos);
}

/** 15000 → "150,00" (sem separador de milhar, para o campo de texto). */
export function centavosParaReais(centavos: number): string {
  if (!Number.isSafeInteger(centavos) || centavos < 0) {
    throw new RangeError(`Valor em centavos inválido: ${centavos}`);
  }
  const absoluto = BigInt(centavos);
  return `${absoluto / 100n},${(absoluto % 100n).toString().padStart(2, '0')}`;
}
