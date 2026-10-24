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

  it.each([200, 399, 600, 422.5])('recusa status %d, que não é de erro HTTP', (status) => {
    expect(() => new ErroApi({ codigo: 'INDISPONIVEL', status, mensagem: 'x' })).toThrow(
      RangeError,
    );
  });
});
