import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { criarLogger, LoggerNestPino } from '../../src/logger/logger.js';
import { criarAppDeTeste } from '../helpers/app-de-teste.js';
import { capturarLogs, UUID } from '../helpers/captura-de-logs.js';
import { MENSAGEM_INTERNA, ModuloDeErros } from '../helpers/modulo-de-erros.js';

describe('logger Pino JSON com requestId (ADR 0018)', () => {
  let app: NestFastifyApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('cada requisição é logada em JSON com um requestId UUID', async () => {
    const { destino, linhas } = capturarLogs();
    app = await criarAppDeTeste({ destinoDosLogs: destino });

    await app.inject({ method: 'GET', url: '/api/health/live' });

    const daRequisicao = linhas.filter((linha) => 'requestId' in linha);
    expect(daRequisicao.length).toBeGreaterThan(0);
    for (const linha of daRequisicao) {
      expect(linha.requestId).toMatch(UUID);
    }
  });

  it('requisições diferentes recebem requestIds diferentes', async () => {
    const { destino, linhas } = capturarLogs();
    app = await criarAppDeTeste({ destinoDosLogs: destino });

    await app.inject({ method: 'GET', url: '/api/health/live' });
    await app.inject({ method: 'GET', url: '/api/health/live' });

    const ids = new Set(linhas.map((linha) => linha.requestId).filter(Boolean));
    expect(ids.size).toBe(2);
  });

  it('ignora um request-id enviado pelo cliente', async () => {
    const { destino, linhas } = capturarLogs();
    app = await criarAppDeTeste({ destinoDosLogs: destino });

    await app.inject({
      method: 'GET',
      url: '/api/health/live',
      headers: { 'request-id': 'forjado', 'x-request-id': 'forjado' },
    });

    expect(linhas.some((linha) => linha.requestId === 'forjado')).toBe(false);
  });

  it('a requisição é logada só com método e caminho, sem query string nem cabeçalhos', async () => {
    const { destino, linhas } = capturarLogs();
    app = await criarAppDeTeste({ destinoDosLogs: destino });

    await app.inject({
      method: 'GET',
      url: '/api/health/live?token=SEGREDO123&email=fulano@exemplo.com',
      headers: { authorization: 'Bearer SEGREDO123', cookie: 'access_token=SEGREDO123' },
    });

    const comReq = linhas.filter((linha) => 'req' in linha);
    expect(comReq.length).toBeGreaterThan(0);
    for (const linha of comReq) {
      expect(linha.req).toEqual({ method: 'GET', url: '/api/health/live' });
    }
    const tudo = JSON.stringify(linhas);
    expect(tudo).not.toContain('SEGREDO123');
    expect(tudo).not.toContain('fulano@exemplo.com');
  });

  it('erro não tratado é logado no servidor com o requestId e a causa', async () => {
    const { destino, linhas } = capturarLogs();
    app = await criarAppDeTeste({ destinoDosLogs: destino, modulosExtras: [ModuloDeErros] });

    await app.inject({ method: 'GET', url: '/api/teste-erros/nao-tratado' });

    const erro = linhas.find((linha) => linha.level === 50);
    expect(erro).toBeDefined();
    expect(erro?.requestId).toMatch(UUID);
    expect(JSON.stringify(erro)).toContain(MENSAGEM_INTERNA);
  });
});

describe('LoggerNestPino', () => {
  it('encaminha os logs do Nest ao Pino com o contexto', () => {
    const { destino, linhas } = capturarLogs();
    const logger = new LoggerNestPino(criarLogger('info', destino));

    logger.log('aplicação iniciada', 'NestApplication');
    logger.warn('cuidado');

    expect(linhas).toEqual([
      expect.objectContaining({
        level: 30,
        msg: 'aplicação iniciada',
        contexto: 'NestApplication',
      }),
      expect.objectContaining({ level: 40, msg: 'cuidado' }),
    ]);
    expect(linhas[1]).not.toHaveProperty('contexto');
  });

  it('respeita o nível configurado', () => {
    const { destino, linhas } = capturarLogs();
    const logger = new LoggerNestPino(criarLogger('warn', destino));

    logger.log('informativo');
    logger.debug('depuração');
    logger.error('falhou', 'pilha simulada', 'Contexto');

    expect(linhas).toEqual([
      expect.objectContaining({
        level: 50,
        msg: 'falhou',
        contexto: 'Contexto',
        stack: 'pilha simulada',
      }),
    ]);
  });

  it('não lança ao logar BigInt nem objeto com referência circular', () => {
    const { destino, linhas } = capturarLogs();
    const logger = new LoggerNestPino(criarLogger('info', destino));
    const circular: Record<string, unknown> = { nome: 'ciclo' };
    circular.eu = circular;

    expect(() => logger.log({ valor: 10n })).not.toThrow();
    expect(() => logger.log(circular)).not.toThrow();
    expect(() => logger.log(10n)).not.toThrow();

    expect(linhas).toHaveLength(3);
    expect(linhas[2]?.msg).toBe('10');
  });

  it('loga Error com a causa serializada', () => {
    const { destino, linhas } = capturarLogs();
    const logger = new LoggerNestPino(criarLogger('info', destino));

    logger.error(new Error('quebrou'), 'Contexto');

    expect(linhas).toEqual([
      expect.objectContaining({ level: 50, msg: 'quebrou', contexto: 'Contexto' }),
    ]);
    expect(linhas[0]?.err).toMatchObject({ message: 'quebrou' });
  });
});
