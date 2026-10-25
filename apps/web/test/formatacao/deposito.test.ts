import { describe, expect, it } from 'vitest';

import { reaisParaCentavos } from '../../src/formatacao/deposito';

describe('reaisParaCentavos', () => {
  it.each([
    ['1', 100],
    ['1,5', 150],
    ['1,50', 150],
    ['1.234,56', 123456],
    ['100.000,00', 10_000_000],
    ['100000', 10_000_000],
    ['1,00', 100],
    [' 25 ', 2500],
  ])('aceita %j como %i centavos', (texto, esperado) => {
    expect(reaisParaCentavos(texto)).toBe(esperado);
  });

  it.each([
    '0,99',
    '0',
    '',
    '   ',
    '100.000,01',
    '100001',
    'abc',
    '1a',
    '1,234',
    '1.23',
    '1..000',
    '-5',
    '1e3',
    '1,',
    ',50',
    'R$ 10',
    '99999999999999999999',
  ])('recusa %j', (texto) => {
    expect(reaisParaCentavos(texto)).toBeNull();
  });
});
