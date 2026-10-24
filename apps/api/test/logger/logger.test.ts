import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { criarLogger, LoggerNestPino } from '../../src/logger/logger.js';
import { criarAppDeTeste } from '../helpers/app-de-teste.js';
import { MENSAGEM_INTERNA, ModuloDeErros } from '../helpers/modulo-de-erros.js';

type LinhaDeLog = Record<string, unknown>;

function capturarLogs(): { destino: { write: (linha: string) => void }; linhas: LinhaDeLog[] } {
  const linhas: LinhaDeLog[] = [];
  return {
    destino: { write: (linha: string) => linhas.push(JSON.parse(linha) as LinhaDeLog) },
    linhas,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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
});
