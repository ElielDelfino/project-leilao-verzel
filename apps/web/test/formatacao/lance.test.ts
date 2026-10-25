import { describe, expect, it } from 'vitest';

import { centavosParaReais, reaisParaCentavosDoLance } from '../../src/formatacao/lance';

describe('reaisParaCentavosDoLance', () => {
  it.each([
    ['150,00', 15_000],
    ['150', 15_000],
    ['0,01', 1],
    ['1.234,5', 123_450],
    ['90.071.992.547.409,91', Number.MAX_SAFE_INTEGER],
    [' 10,10 ', 1010],
  ])('aceita %j como %i centavos', (texto, esperado) => {
    expect(reaisParaCentavosDoLance(texto)).toBe(esperado);
  });

  it.each(['', '0', '0,00', 'abc', '1,234', '1,', '-5', '1.23', '90.071.992.547.409,92', '1e3'])(
    'recusa %j',
    (texto) => {
      expect(reaisParaCentavosDoLance(texto)).toBeNull();
    },
  );
});

describe('centavosParaReais', () => {
  it('formata sem separador de milhar e vai e volta sem perda', () => {
    expect(centavosParaReais(15_000)).toBe('150,00');
    expect(centavosParaReais(5)).toBe('0,05');
    expect(reaisParaCentavosDoLance(centavosParaReais(Number.MAX_SAFE_INTEGER))).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });

  it('lança para valor que não é inteiro seguro', () => {
    expect(() => centavosParaReais(1.5)).toThrow(RangeError);
  });
});
