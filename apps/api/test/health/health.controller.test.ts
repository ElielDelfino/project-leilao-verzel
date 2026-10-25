import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Banco } from '../../src/db/banco.js';
import type { VerificacaoDeProntidao } from '../../src/health/prontidao.js';
import { bancoFalso, criarAppDeTeste, redisFalso } from '../helpers/app-de-teste.js';

const ok = (nome: string): VerificacaoDeProntidao => ({ nome, verificar: async () => {} });
const fora = (nome: string): VerificacaoDeProntidao => ({
  nome,
  verificar: async () => {
    throw new Error(`conexão recusada em ${nome}`);
  },
});

describe('health checks (specs/001, specs/014 §Observabilidade, openapi.yaml)', () => {
  let app: NestFastifyApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('GET /api/health/live responde 200 no envelope de sucesso', async () => {
    app = await criarAppDeTeste();

    const resposta = await app.inject({ method: 'GET', url: '/api/health/live' });

    expect(resposta.statusCode).toBe(200);
    expect(resposta.headers['content-type']).toMatch(/application\/json/);
    expect(resposta.json()).toEqual({ sucesso: true, dados: { status: 'ok' } });
  });

  it('GET /api/health/ready responde 200 quando Postgres e Redis respondem', async () => {
    app = await criarAppDeTeste({ verificacoes: [ok('postgres'), ok('redis')] });

    const resposta = await app.inject({ method: 'GET', url: '/api/health/ready' });

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toEqual({ sucesso: true, dados: { status: 'ok' } });
  });

  it('GET /api/health/ready responde 503 INDISPONIVEL quando o Redis está fora', async () => {
    app = await criarAppDeTeste({ verificacoes: [ok('postgres'), fora('redis')] });

    const resposta = await app.inject({ method: 'GET', url: '/api/health/ready' });

    expect(resposta.statusCode).toBe(503);
    const corpo = resposta.json<{ sucesso: boolean; erro: { codigo: string; mensagem: string } }>();
    expect(corpo.sucesso).toBe(false);
    expect(corpo.erro.codigo).toBe('INDISPONIVEL');
    expect(typeof corpo.erro.mensagem).toBe('string');
    expect(resposta.body).not.toContain('conexão recusada');
  });

  it('GET /api/health/ready responde 503 quando o Postgres está fora', async () => {
    app = await criarAppDeTeste({ verificacoes: [fora('postgres'), ok('redis')] });

    const resposta = await app.inject({ method: 'GET', url: '/api/health/ready' });

    expect(resposta.statusCode).toBe(503);
    expect(resposta.json()).toMatchObject({ sucesso: false, erro: { codigo: 'INDISPONIVEL' } });
  });

  it('GET /api/health/ready não se declara pronto sem verificações registradas', async () => {
    app = await criarAppDeTeste({ verificacoes: [] });

    const resposta = await app.inject({ method: 'GET', url: '/api/health/ready' });

    expect(resposta.statusCode).toBe(503);
    expect(resposta.json()).toMatchObject({ sucesso: false, erro: { codigo: 'INDISPONIVEL' } });
  });

  // Tarefa 017: as verificações registradas são as do pool do Postgres e do cliente Redis.
  it('o HealthModule registra as verificações de Postgres e Redis com os clientes injetados', async () => {
    const execute = vi.fn(async () => ({ rows: [] }));
    const banco = {
      ...bancoFalso(),
      consultar: vi.fn(async (fn: (db: never) => Promise<unknown>) => fn({ execute } as never)),
    } as unknown as Banco;
    const ping = vi.fn(async () => {});
    app = await criarAppDeTeste({ banco, redis: { ...redisFalso(), ping } });

    const resposta = await app.inject({ method: 'GET', url: '/api/health/ready' });

    expect(resposta.statusCode).toBe(200);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(ping).toHaveBeenCalledWith(expect.any(AbortSignal));
  });

  it('GET /api/health/ready responde 503 quando o PING do Redis registrado falha', async () => {
    const banco = {
      ...bancoFalso(),
      consultar: async (fn: (db: never) => Promise<unknown>) =>
        fn({ execute: async () => ({ rows: [] }) } as never),
    } as unknown as Banco;
    app = await criarAppDeTeste({ banco, redis: redisFalso() });

    const resposta = await app.inject({ method: 'GET', url: '/api/health/ready' });

    expect(resposta.statusCode).toBe(503);
  });

  it('ao fechar a API, encerra o pool do Postgres e o cliente Redis', async () => {
    const banco = bancoFalso();
    const redis = redisFalso();
    app = await criarAppDeTeste({ banco, redis });

    await app.close();
    app = undefined;

    expect(banco.encerrado()).toBe(true);
    expect(redis.encerrado()).toBe(true);
  });

  it('as rotas só existem sob o prefixo /api', async () => {
    app = await criarAppDeTeste();

    const resposta = await app.inject({ method: 'GET', url: '/health/live' });

    expect(resposta.statusCode).toBe(404);
    expect(resposta.json()).toMatchObject({ sucesso: false, erro: { codigo: 'NAO_ENCONTRADO' } });
  });
});
