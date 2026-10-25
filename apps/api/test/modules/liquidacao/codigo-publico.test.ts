// Código público do comprovante (specs/010 §Dados, tarefa 105): 16 caracteres base62 por
// amostragem por rejeição sobre bytes de `crypto.randomBytes`, sem viés de módulo.
import { describe, expect, it } from 'vitest';

import {
  ALFABETO_DO_CODIGO,
  gerarCodigoPublico,
  TAMANHO_DO_CODIGO,
} from '../../../src/modules/liquidacao/encerramento/codigo-publico.js';
import { FORMATO_DO_CODIGO_PUBLICO } from '../../../src/modules/liquidacao/schema.js';

/** Fonte de bytes determinística: devolve as fatias da lista, na ordem, e registra os pedidos. */
function fonteFixa(lotes: readonly number[][]): {
  sortear: (n: number) => Buffer;
  pedidos: number[];
} {
  const pedidos: number[] = [];
  let i = 0;
  return {
    pedidos,
    sortear: (n) => {
      pedidos.push(n);
      const proximo = lotes[i] ?? [];
      i += 1;
      return Buffer.from(proximo.slice(0, n));
    },
  };
}

describe('gerarCodigoPublico', () => {
  it('gera 16 caracteres base62 que casam com o CHECK de receipts', () => {
    const codigo = gerarCodigoPublico();

    expect(codigo).toHaveLength(TAMANHO_DO_CODIGO);
    expect(codigo).toMatch(new RegExp(FORMATO_DO_CODIGO_PUBLICO));
  });

  it('usa o alfabeto 0-9A-Za-z na ordem e mapeia byte % 62', () => {
    expect(ALFABETO_DO_CODIGO).toBe(
      '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
    );
    // 0 → '0', 61 → 'z', 62 → '0', 247 (4 × 62 − 1) → 'z'.
    const bytes = [0, 61, 62, 247, 10, 36, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1];
    const { sortear } = fonteFixa([bytes]);

    expect(gerarCodigoPublico(sortear)).toBe('0z0zAa0000000001');
  });

  it('descarta bytes ≥ 248 e sorteia de novo até completar 16 caracteres', () => {
    const rejeitados = [248, 255, 250, 249];
    const primeiro = [...rejeitados, ...Array.from({ length: 12 }, () => 1)];
    const { sortear, pedidos } = fonteFixa([primeiro, [2, 2, 2, 2]]);

    const codigo = gerarCodigoPublico(sortear);

    expect(codigo).toBe('1'.repeat(12) + '2222');
    expect(pedidos).toEqual([16, 4]);
  });

  it('não repete códigos em sorteios sucessivos', () => {
    const codigos = new Set(Array.from({ length: 200 }, () => gerarCodigoPublico()));

    expect(codigos.size).toBe(200);
  });
});
