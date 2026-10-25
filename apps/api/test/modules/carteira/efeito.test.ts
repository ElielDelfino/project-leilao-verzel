// Unidade: efeito de cada tipo de lançamento na projeção (specs/004 §Comportamento, tabela).
import { describe, expect, it } from 'vitest';

import {
  aplicarEfeito,
  efeitoDoLancamento,
  inteiroSeguro,
  TIPOS_DE_LANCAMENTO,
} from '../../../src/modules/carteira/efeito.js';

describe('efeitoDoLancamento', () => {
  it.each([
    ['deposito', { total: 500, comprometido: 0 }],
    ['compromisso', { total: 0, comprometido: 500 }],
    ['liberacao', { total: 0, comprometido: -500 }],
    ['estorno', { total: 0, comprometido: -500 }],
    ['debito_arremate', { total: -500, comprometido: -500 }],
    ['credito_arremate', { total: 500, comprometido: 0 }],
  ] as const)('%s de 500 → %o', (tipo, esperado) => {
    expect(efeitoDoLancamento(tipo, 500)).toEqual(esperado);
  });

  it('cobre os 6 tipos do enum tipo_lancamento', () => {
    expect([...TIPOS_DE_LANCAMENTO].sort()).toEqual(
      [
        'compromisso',
        'credito_arremate',
        'debito_arremate',
        'deposito',
        'estorno',
        'liberacao',
      ].sort(),
    );
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN])(
    'valor %s fora de inteiro positivo seguro → RangeError',
    (valor) => {
      expect(() => efeitoDoLancamento('deposito', valor)).toThrow(RangeError);
    },
  );
});

describe('aplicarEfeito', () => {
  it('soma o efeito ao saldo sem alterar o original', () => {
    const saldo = Object.freeze({ total: 1000, comprometido: 300 });

    const novo = aplicarEfeito(saldo, efeitoDoLancamento('debito_arremate', 300));

    expect(novo).toEqual({ total: 700, comprometido: 0 });
    expect(saldo).toEqual({ total: 1000, comprometido: 300 });
  });
});

describe('inteiroSeguro', () => {
  it.each([
    ['25', 25],
    [25n, 25],
    [0, 0],
    [String(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER],
  ] as const)('%s → %s', (valor, esperado) => {
    expect(inteiroSeguro(valor)).toBe(esperado);
  });

  it.each([
    String(Number.MAX_SAFE_INTEGER + 1),
    BigInt(Number.MAX_SAFE_INTEGER) + 1n,
    -1,
    '1.5',
    'abc',
    '',
    1.5,
    null,
  ])('%s → RangeError', (valor) => {
    expect(() => inteiroSeguro(valor)).toThrow(RangeError);
  });
});
