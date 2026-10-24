import { describe, expect, it } from 'vitest';

import { formatarCentavos } from '../../src/formatacao/dinheiro';

// Intl pt-BR separa "R$" do valor com espaço não separável (U+00A0).
const NBSP = ' ';

describe('formatarCentavos', () => {
  it('formata centavos inteiros como BRL em pt-BR', () => {
    expect(formatarCentavos(123456)).toBe(`R$${NBSP}1.234,56`);
  });

  it('formata zero e valores menores que um real', () => {
    expect(formatarCentavos(0)).toBe(`R$${NBSP}0,00`);
    expect(formatarCentavos(5)).toBe(`R$${NBSP}0,05`);
    expect(formatarCentavos(99)).toBe(`R$${NBSP}0,99`);
  });

  it('formata valores negativos (estornos no extrato)', () => {
    expect(formatarCentavos(-2550)).toBe(`-R$${NBSP}25,50`);
  });

  it('formata o maior inteiro seguro sem perder precisão', () => {
    expect(formatarCentavos(Number.MAX_SAFE_INTEGER)).toBe(`R$${NBSP}90.071.992.547.409,91`);
  });

  it.each([12.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'recusa valor que não é inteiro seguro de centavos (%s)',
    (valor) => {
      expect(() => formatarCentavos(valor)).toThrow(RangeError);
    },
  );
});
