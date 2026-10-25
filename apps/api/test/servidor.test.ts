import { Logger } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { ErroDeConfiguracao } from '../src/config/env.js';
import { criarApi, descreverFalhaNoBoot } from '../src/servidor.js';
import { ENV_DE_TESTE } from './helpers/app-de-teste.js';
import { capturarLogs, UUID } from './helpers/captura-de-logs.js';

const ENV_INFO = { ...ENV_DE_TESTE, LOG_LEVEL: 'info' } as const;

// Caminho de produção (o mesmo de main.ts): NestFactory + adaptador Fastify + LoggerNestPino.
describe('criarApi (caminho de produção do main.ts)', () => {
  let app: NestFastifyApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('os logs de boot do Nest saem em JSON pelo Pino, com contexto', async () => {
    const { destino, linhas } = capturarLogs();

    app = await criarApi(ENV_INFO, destino);
    await app.init();

    expect(linhas).toContainEqual(
      expect.objectContaining({ level: 30, contexto: 'InstanceLoader' }),
    );
    expect(linhas).toContainEqual(
      expect.objectContaining({
        contexto: 'RouterExplorer',
        msg: expect.stringContaining('/api/health/live'),
      }),
    );
  });

  it('um Logger do Nest criado por um módulo escreve JSON no mesmo destino', async () => {
    const { destino, linhas } = capturarLogs();
    app = await criarApi(ENV_INFO, destino);
    await app.init();

    new Logger('ModuloQualquer').warn('aviso de um módulo');

    expect(linhas).toContainEqual(
      expect.objectContaining({ level: 40, contexto: 'ModuloQualquer', msg: 'aviso de um módulo' }),
    );
  });

  it('serve as rotas sob /api com o filtro global e requestId nos logs', async () => {
    const { destino, linhas } = capturarLogs();
    app = await criarApi(ENV_INFO, destino);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const viva = await app.inject({ method: 'GET', url: '/api/health/live' });
    const pronta = await app.inject({ method: 'GET', url: '/api/health/ready' });

    expect(viva.statusCode).toBe(200);
    // ENV_DE_TESTE aponta Postgres e Redis para a porta 1: os clientes reais recebem ECONNREFUSED.
    expect(pronta.statusCode).toBe(503);
    expect(pronta.json()).toMatchObject({ sucesso: false, erro: { codigo: 'INDISPONIVEL' } });
    const avisos = linhas.filter((linha) => String(linha.msg).includes('prontidão falhou'));
    expect(avisos.map((linha) => linha.msg)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('postgres'),
        expect.stringContaining('redis'),
      ]),
    );
    expect(JSON.stringify(linhas)).not.toContain('127.0.0.1');
    expect(
      linhas.filter((linha) => 'requestId' in linha).every((l) => UUID.test(String(l.requestId))),
    ).toBe(true);
    expect(linhas.some((linha) => 'requestId' in linha)).toBe(true);
  });
});

describe('descreverFalhaNoBoot', () => {
  const AGORA = new Date('2026-10-24T20:00:00.000Z');

  it('env inválido vira uma linha JSON fatal só com os nomes das variáveis', () => {
    const linha = descreverFalhaNoBoot(
      new ErroDeConfiguracao('Variáveis inválidas: API_PORT'),
      AGORA,
    );

    expect(linha.endsWith('\n')).toBe(true);
    expect(JSON.parse(linha)).toEqual({
      level: 60,
      time: '2026-10-24T20:00:00.000Z',
      msg: 'Variáveis inválidas: API_PORT',
    });
  });

  it('outra falha de boot leva a causa com stack para o operador', () => {
    const linha = JSON.parse(descreverFalhaNoBoot(new Error('porta em uso'), AGORA)) as {
      msg: string;
      err: { type: string; message: string; stack: string };
    };

    expect(linha.msg).toBe('falha ao iniciar a API');
    expect(linha.err).toMatchObject({ type: 'Error', message: 'porta em uso' });
    expect(linha.err.stack).toContain('porta em uso');
  });

  it('valor lançado que não é Error não é serializado', () => {
    const linha = JSON.parse(descreverFalhaNoBoot('segredo=123', AGORA)) as Record<string, unknown>;

    expect(linha).toEqual({
      level: 60,
      time: '2026-10-24T20:00:00.000Z',
      msg: 'falha ao iniciar a API',
    });
  });
});
