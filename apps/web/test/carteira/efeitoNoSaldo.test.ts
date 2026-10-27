import { describe, expect, it } from 'vitest';

import { efeitoNoSaldo, valorComSinal } from '../../src/carteira/efeitoNoSaldo';

// Intl pt-BR separa "R$" do valor com espaço não separável (U+00A0).
const NBSP = ' ';

describe('efeitoNoSaldo', () => {
  // Tabela de specs/004 §Comportamento, vista pelo disponível do usuário.
  it.each([
    ['deposito', 'entrada', '+'],
    ['credito_arremate', 'entrada', '+'],
    ['debito_arremate', 'saida', '−'],
    ['compromisso', 'reserva', '−'],
    ['liberacao', 'devolucao', '+'],
    ['estorno', 'devolucao', '+'],
  ] as const)('%s é %s com sinal %s', (tipo, efeito, sinal) => {
    expect(efeitoNoSaldo(tipo)).toEqual({ efeito, sinal });
  });
});

describe('valorComSinal', () => {
  it('põe o sinal antes do valor formatado (valor da API é sempre positivo)', () => {
    expect(valorComSinal('deposito', 123_456)).toBe(`+${NBSP}R$${NBSP}1.234,56`);
    expect(valorComSinal('compromisso', 5_000)).toBe(`−${NBSP}R$${NBSP}50,00`);
  });
});
