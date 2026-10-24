import { describe, expect, it } from 'vitest';

import { ErroApi } from '../../../src/common/erros/erro-api.js';

describe('ErroApi', () => {
  it('guarda código, status, mensagem e detalhes', () => {
    const erro = new ErroApi({
      codigo: 'DADOS_INVALIDOS',
      status: 422,
      mensagem: 'Dados inválidos.',
      detalhes: { campo: 'lanceMinimoCentavos' },
    });

    expect(erro).toBeInstanceOf(Error);
    expect(erro.codigo).toBe('DADOS_INVALIDOS');
    expect(erro.status).toBe(422);
    expect(erro.message).toBe('Dados inválidos.');
    expect(erro.detalhes).toEqual({ campo: 'lanceMinimoCentavos' });
  });

  it('detalhes ficam indefinidos quando não informados', () => {
    const erro = new ErroApi({ codigo: 'NAO_ENCONTRADO', status: 404, mensagem: 'x' });

    expect(erro.detalhes).toBeUndefined();
  });

  it('aceita detalhes com valores primitivos (string, número, booleano, null)', () => {
    const erro = new ErroApi({
      codigo: 'CATALOGO_INDISPONIVEL',
      status: 503,
      mensagem: 'x',
      detalhes: {
        tenteNovamenteEm: '2026-10-24T20:00:00Z',
        segundos: 30,
        aberto: true,
        motivo: null,
      },
    });

    expect(erro.detalhes).toEqual({
      tenteNovamenteEm: '2026-10-24T20:00:00Z',
      segundos: 30,
      aberto: true,
      motivo: null,
    });
  });

  it('os tipos recusam objetos e listas em detalhes (evita vazar PII aninhada)', () => {
    const construir = (detalhes: unknown) => () =>
      new ErroApi({
        codigo: 'DADOS_INVALIDOS',
        status: 422,
        mensagem: 'x',
        // @ts-expect-error -- detalhes só aceita valores primitivos
        detalhes,
      });

    // @ts-expect-error -- objeto aninhado não é primitivo
    const tipoAninhado: ConstructorParameters<typeof ErroApi>[0]['detalhes'] = {
      usuario: { email: 'a@b.c' },
    };
    expect(tipoAninhado).toBeDefined();

    expect(construir({ usuario: { email: 'a@b.c' } })).toThrow(TypeError);
    expect(construir({ itens: [1, 2] })).toThrow(TypeError);
    expect(construir({ quando: new Date() })).toThrow(TypeError);
    expect(construir({ valor: 10n })).toThrow(TypeError);
    expect(construir({ valor: Number.NaN })).toThrow(TypeError);
  });

  it.each([200, 399, 600, 422.5])('recusa status %d, que não é de erro HTTP', (status) => {
    expect(() => new ErroApi({ codigo: 'INDISPONIVEL', status, mensagem: 'x' })).toThrow(
      RangeError,
    );
  });
});
