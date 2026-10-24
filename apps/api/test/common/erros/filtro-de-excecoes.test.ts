import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { criarAppDeTeste } from '../../helpers/app-de-teste.js';
import { MENSAGEM_INTERNA, ModuloDeErros, PII_DO_DRIVER } from '../../helpers/modulo-de-erros.js';

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

  it('HttpException 4xx do framework mantém o status, com código do catálogo e mensagem fixa', async () => {
    const resposta = await app.inject({
      method: 'GET',
      url: '/api/teste-erros/http-do-framework',
    });

    expect(resposta.statusCode).toBe(400);
    expect(resposta.json()).toEqual({
      sucesso: false,
      erro: { codigo: 'DADOS_INVALIDOS', mensagem: expect.any(String) },
    });
    expect(resposta.body).not.toContain(MENSAGEM_INTERNA);
  });

  it.each([
    [400, 'DADOS_INVALIDOS'],
    [401, 'NAO_AUTENTICADO'],
    [403, 'PAPEL_NAO_PERMITIDO'],
    [404, 'NAO_ENCONTRADO'],
    [405, 'NAO_ENCONTRADO'],
    [409, 'DADOS_INVALIDOS'],
    [413, 'DADOS_INVALIDOS'],
    [415, 'DADOS_INVALIDOS'],
    [418, 'DADOS_INVALIDOS'],
    [422, 'DADOS_INVALIDOS'],
    [429, 'MUITAS_TENTATIVAS'],
  ])('HttpException %d mantém o status e responde o código %s', async (status, codigo) => {
    const resposta = await app.inject({ method: 'GET', url: `/api/teste-erros/http/${status}` });

    expect(resposta.statusCode).toBe(status);
    expect(resposta.json()).toEqual({
      sucesso: false,
      erro: { codigo, mensagem: expect.any(String) },
    });
    expect(resposta.body).not.toContain(MENSAGEM_INTERNA);
  });

  it('HttpException 403 responde PAPEL_NAO_PERMITIDO com a mensagem de specs/012', async () => {
    const resposta = await app.inject({ method: 'GET', url: '/api/teste-erros/http/403' });

    expect(resposta.statusCode).toBe(403);
    expect(resposta.json()).toEqual({
      sucesso: false,
      erro: {
        codigo: 'PAPEL_NAO_PERMITIDO',
        mensagem: 'Sua conta não tem permissão para esta ação.',
      },
    });
  });

  it.each([500, 502, 503, 504])(
    'HttpException %d mantém o status 5xx, com corpo INDISPONIVEL',
    async (status) => {
      const resposta = await app.inject({ method: 'GET', url: `/api/teste-erros/http/${status}` });

      expect(resposta.statusCode).toBe(status);
      expect(resposta.json()).toEqual({
        sucesso: false,
        erro: { codigo: 'INDISPONIVEL', mensagem: expect.any(String) },
      });
      expect(resposta.body).not.toContain(MENSAGEM_INTERNA);
    },
  );

  it.each([400, 404, 409, 429])(
    'erro de biblioteca externa com statusCode %d vira 500 INDISPONIVEL',
    async (status) => {
      const resposta = await app.inject({
        method: 'GET',
        url: `/api/teste-erros/biblioteca/${status}`,
      });

      expect(resposta.statusCode).toBe(500);
      expect(resposta.json()).toEqual({
        sucesso: false,
        erro: { codigo: 'INDISPONIVEL', mensagem: expect.any(String) },
      });
      expect(resposta.body).not.toContain(MENSAGEM_INTERNA);
    },
  );

  it('objeto lançado com statusCode 4xx vira 500 INDISPONIVEL', async () => {
    const resposta = await app.inject({ method: 'GET', url: '/api/teste-erros/objeto-com-status' });

    expect(resposta.statusCode).toBe(500);
    expect(resposta.json()).toMatchObject({ sucesso: false, erro: { codigo: 'INDISPONIVEL' } });
  });

  it('URL malformada vira 400 DADOS_INVALIDOS no envelope, sem refletir a URL', async () => {
    const resposta = await app.inject({ method: 'GET', url: '/api/%E0%A4%A' });

    expect(resposta.statusCode).toBe(400);
    expect(resposta.headers['content-type']).toMatch(/application\/json/);
    expect(resposta.json()).toEqual({
      sucesso: false,
      erro: { codigo: 'DADOS_INVALIDOS', mensagem: 'Requisição inválida.' },
    });
    expect(resposta.body).not.toContain('%E0%A4%A');
    expect(resposta.body).not.toContain('FST_ERR');
  });

  it('parâmetro de rota longo demais vira 414 DADOS_INVALIDOS no envelope, sem refletir o valor', async () => {
    const parametro = '7'.repeat(101);

    const resposta = await app.inject({ method: 'GET', url: `/api/teste-erros/http/${parametro}` });

    expect(resposta.statusCode).toBe(414);
    expect(resposta.json()).toEqual({
      sucesso: false,
      erro: { codigo: 'DADOS_INVALIDOS', mensagem: 'Requisição inválida.' },
    });
    expect(resposta.body).not.toContain(parametro);
    expect(resposta.body).not.toContain('FST_ERR');
  });

  it('POST com JSON malformado responde 400 DADOS_INVALIDOS', async () => {
    const resposta = await app.inject({
      method: 'POST',
      url: '/api/teste-erros/eco',
      headers: { 'content-type': 'application/json' },
      payload: '{"lance": ',
    });

    expect(resposta.statusCode).toBe(400);
    expect(resposta.json()).toEqual({
      sucesso: false,
      erro: { codigo: 'DADOS_INVALIDOS', mensagem: expect.any(String) },
    });
  });

  it('POST com corpo acima do limite responde 413 DADOS_INVALIDOS', async () => {
    const corpoGrande = JSON.stringify({ texto: 'x'.repeat(1_100_000) });

    const resposta = await app.inject({
      method: 'POST',
      url: '/api/teste-erros/eco',
      headers: { 'content-type': 'application/json' },
      payload: corpoGrande,
    });

    expect(resposta.statusCode).toBe(413);
    expect(resposta.json()).toMatchObject({ sucesso: false, erro: { codigo: 'DADOS_INVALIDOS' } });
  });

  it('POST com content-type não suportado responde 415 DADOS_INVALIDOS', async () => {
    const resposta = await app.inject({
      method: 'POST',
      url: '/api/teste-erros/eco',
      headers: { 'content-type': 'application/xml' },
      payload: '<lance/>',
    });

    expect(resposta.statusCode).toBe(415);
    expect(resposta.json()).toMatchObject({ sucesso: false, erro: { codigo: 'DADOS_INVALIDOS' } });
  });

  it('POST com JSON válido continua funcionando', async () => {
    const resposta = await app.inject({
      method: 'POST',
      url: '/api/teste-erros/eco',
      payload: { valorCentavos: 1500 },
    });

    expect(resposta.statusCode).toBe(201);
    expect(resposta.json()).toEqual({ sucesso: true, dados: { valorCentavos: 1500 } });
  });
});

describe('filtro global de exceções: nível dos logs', () => {
  let app: NestFastifyApplication;
  const linhas: Record<string, unknown>[] = [];

  beforeAll(async () => {
    app = await criarAppDeTeste({
      modulosExtras: [ModuloDeErros],
      destinoDosLogs: { write: (linha: string) => linhas.push(JSON.parse(linha)) },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  const NIVEL_WARN = 40;
  const NIVEL_ERROR = 50;

  async function logsDoFiltro(
    url: string,
    init: { method?: 'GET' | 'POST'; payload?: string } = {},
  ) {
    linhas.length = 0;
    await app.inject({
      method: init.method ?? 'GET',
      url,
      ...(init.payload === undefined
        ? {}
        : { payload: init.payload, headers: { 'content-type': 'application/json' } }),
    });
    // As linhas "incoming request" e "request completed" são do Fastify (nível 30).
    return linhas.filter((linha) => typeof linha.level === 'number' && linha.level >= NIVEL_WARN);
  }

  it('erro 4xx do cliente vai para o log em warn, sem stack nem mensagem da exceção', async () => {
    const logs = await logsDoFiltro('/api/teste-erros/eco', { method: 'POST', payload: '{' });

    expect(logs).toHaveLength(1);
    expect(logs[0]?.level).toBe(NIVEL_WARN);
    expect(logs[0]).toMatchObject({ status: 400, codigo: 'DADOS_INVALIDOS' });
    expect(JSON.stringify(logs[0])).not.toMatch(/stack|\bat\s.+:\d+:\d+/);
  });

  it('HttpException 4xx não registra a mensagem interna', async () => {
    const logs = await logsDoFiltro('/api/teste-erros/http-do-framework');

    expect(logs).toHaveLength(1);
    expect(logs[0]?.level).toBe(NIVEL_WARN);
    expect(JSON.stringify(logs[0])).not.toContain(MENSAGEM_INTERNA);
  });

  it('ErroApi 4xx não gera log de erro', async () => {
    const logs = await logsDoFiltro('/api/teste-erros/dominio');

    expect(logs).toEqual([]);
  });

  it('ErroApi 5xx vai para o log em error', async () => {
    const logs = await logsDoFiltro('/api/teste-erros/dominio-5xx');

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      level: NIVEL_ERROR,
      codigo: 'CATALOGO_INDISPONIVEL',
      status: 503,
    });
  });

  it('URL malformada vai para o log em warn, sem stack, sem a URL e sem log em info do erro', async () => {
    linhas.length = 0;
    await app.inject({ method: 'GET', url: '/api/%E0%A4%A' });

    const doErro = linhas.filter((linha) => 'err' in linha || 'status' in linha);
    expect(doErro).toHaveLength(1);
    expect(doErro[0]).toMatchObject({
      level: NIVEL_WARN,
      status: 400,
      codigo: 'DADOS_INVALIDOS',
      codigoInterno: 'FST_ERR_BAD_URL',
    });
    expect(doErro[0]?.requestId).toEqual(expect.any(String));
    expect(JSON.stringify(doErro[0])).not.toMatch(/stack|\bat\s.+:\d+:\d+|%E0%A4%A/);
  });

  it('HttpException 5xx vai para o log em error com o status', async () => {
    const logs = await logsDoFiltro('/api/teste-erros/http/503');

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ level: NIVEL_ERROR, status: 503 });
  });

  it('erro de biblioteca com statusCode 4xx vai para o log em error, como erro não tratado', async () => {
    const logs = await logsDoFiltro('/api/teste-erros/biblioteca/404');

    expect(logs).toHaveLength(1);
    expect(logs[0]?.level).toBe(NIVEL_ERROR);
  });

  it('erro de driver não leva detail nem parameters (PII) ao log', async () => {
    const logs = await logsDoFiltro('/api/teste-erros/driver');

    expect(logs).toHaveLength(1);
    expect(logs[0]?.level).toBe(NIVEL_ERROR);
    expect(logs[0]?.err).toMatchObject({ code: '23505', message: expect.any(String) });
    expect(logs[0]?.err).not.toHaveProperty('detail');
    expect(logs[0]?.err).not.toHaveProperty('parameters');
    expect(logs[0]?.err).not.toHaveProperty('params');
    expect(JSON.stringify(logs[0])).not.toContain(PII_DO_DRIVER);
  });

  it('erro não tratado vai para o log em error com a causa', async () => {
    const logs = await logsDoFiltro('/api/teste-erros/nao-tratado');

    expect(logs).toHaveLength(1);
    expect(logs[0]?.level).toBe(NIVEL_ERROR);
    expect(JSON.stringify(logs[0])).toContain(MENSAGEM_INTERNA);
  });
});
