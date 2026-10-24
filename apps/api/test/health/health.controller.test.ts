import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterEach, describe, expect, it } from 'vitest';

import type { VerificacaoDeProntidao } from '../../src/health/prontidao.js';
import { criarAppDeTeste } from '../helpers/app-de-teste.js';

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
    app = await criarAppDeTeste();

    const resposta = await app.inject({ method: 'GET', url: '/api/health/ready' });

    expect(resposta.statusCode).toBe(503);
    expect(resposta.json()).toMatchObject({ sucesso: false, erro: { codigo: 'INDISPONIVEL' } });
  });

  it('as rotas só existem sob o prefixo /api', async () => {
    app = await criarAppDeTeste();

    const resposta = await app.inject({ method: 'GET', url: '/health/live' });

    expect(resposta.statusCode).toBe(404);
    expect(resposta.json()).toMatchObject({ sucesso: false, erro: { codigo: 'NAO_ENCONTRADO' } });
  });
});
