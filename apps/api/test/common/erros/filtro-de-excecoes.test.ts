import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { criarAppDeTeste } from '../../helpers/app-de-teste.js';
import { MENSAGEM_INTERNA, ModuloDeErros } from '../../helpers/modulo-de-erros.js';

describe('filtro global de exceções (envelope de erro de specs/001 §Contratos)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await criarAppDeTeste({ modulosExtras: [ModuloDeErros] });
  });

  afterAll(async () => {
    await app.close();
  });

  it('erro não tratado vira 500 INDISPONIVEL, sem stack trace nem mensagem interna', async () => {
    const resposta = await app.inject({ method: 'GET', url: '/api/teste-erros/nao-tratado' });

    expect(resposta.statusCode).toBe(500);
    expect(resposta.headers['content-type']).toMatch(/application\/json/);
    expect(resposta.json()).toEqual({
      sucesso: false,
      erro: { codigo: 'INDISPONIVEL', mensagem: expect.any(String) },
    });
    expect(resposta.body).not.toContain(MENSAGEM_INTERNA);
    expect(resposta.body).not.toMatch(/\bat\s.+:\d+:\d+/);
    expect(resposta.body).not.toContain('stack');
  });

  it('valor lançado que não é Error também vira INDISPONIVEL', async () => {
    const resposta = await app.inject({ method: 'GET', url: '/api/teste-erros/nao-error' });

    expect(resposta.statusCode).toBe(500);
    expect(resposta.json()).toMatchObject({ sucesso: false, erro: { codigo: 'INDISPONIVEL' } });
    expect(resposta.body).not.toContain(MENSAGEM_INTERNA);
  });

  it('ErroApi preserva código, status, mensagem e detalhes', async () => {
    const resposta = await app.inject({ method: 'GET', url: '/api/teste-erros/dominio' });

    expect(resposta.statusCode).toBe(422);
    expect(resposta.json()).toEqual({
      sucesso: false,
      erro: {
        codigo: 'SALDO_INSUFICIENTE',
        mensagem: 'Saldo disponível insuficiente.',
        detalhes: { faltamCentavos: 1500 },
      },
    });
  });

  it('ErroApi sem detalhes omite o campo detalhes', async () => {
    const resposta = await app.inject({
      method: 'GET',
      url: '/api/teste-erros/dominio-sem-detalhes',
    });

    expect(resposta.statusCode).toBe(409);
    expect(resposta.json()).toEqual({
      sucesso: false,
      erro: { codigo: 'LOTE_ENCERRADO', mensagem: 'Lote encerrado.' },
    });
  });

  it('rota inexistente vira 404 NAO_ENCONTRADO no envelope', async () => {
    const resposta = await app.inject({ method: 'GET', url: '/api/nao-existe' });

    expect(resposta.statusCode).toBe(404);
    expect(resposta.json()).toEqual({
      sucesso: false,
      erro: { codigo: 'NAO_ENCONTRADO', mensagem: expect.any(String) },
    });
  });

  it('HttpException do framework sem código catalogado vira INDISPONIVEL sem vazar a mensagem', async () => {
    const resposta = await app.inject({
      method: 'GET',
      url: '/api/teste-erros/http-do-framework',
    });

    expect(resposta.statusCode).toBe(500);
    expect(resposta.json()).toMatchObject({ sucesso: false, erro: { codigo: 'INDISPONIVEL' } });
    expect(resposta.body).not.toContain(MENSAGEM_INTERNA);
  });
});
