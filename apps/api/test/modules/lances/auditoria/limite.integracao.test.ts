// Integração (Postgres e Redis reais): rate limit das rotas públicas de auditoria (specs/011 §Rate
// limit, regime até a tarefa 020). Um contador só para `GET /api/auditoria/lotes/{id}` e
// `GET /api/auditoria/chaves`, chave `ratelimit:auditoria:global` (aqui sob um prefixo próprio do
// teste), teto de 600 por janela fixa de 60 s. O contador é posto perto do teto com SET ... EX.
import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { LightMyRequestResponse } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { registrarChaveDeAssinatura } from '../../../../src/modules/lances/index.js';
import { apagarChavesDoPrefixo, clienteDeTeste } from '../../../common/limite/redis-de-teste.js';
import { criarAppDeTeste } from '../../../helpers/app-de-teste.js';
import { inserirLote, inserirUsuario } from '../../../helpers/lotes-por-sql.js';
import { BANCO, envReal, INFRA_DISPONIVEL, REDIS } from '../../identidade/ambiente.js';

const TETO = 600;
const JANELA_S = 60;
const UUID_INEXISTENTE = '0192f000-0000-7000-8000-00000000beef';
const MALFORMADAS = 1000;

type ClienteDeTeste = Awaited<ReturnType<typeof clienteDeTeste>>;

describe.skipIf(!INFRA_DISPONIVEL)('rate limit da auditoria pública (Redis real)', () => {
  const prefixo = `ratelimit:teste-${randomUUID()}:`;
  const chave = `${prefixo}auditoria:global`;
  let app: NestFastifyApplication;
  let redis: ClienteDeTeste;
  let pool: pg.Pool;
  let loteId: string;

  beforeAll(async () => {
    app = await criarAppDeTeste({ env: envReal(), clientesReais: true, prefixoDoLimite: prefixo });
    await registrarChaveDeAssinatura(app);
    redis = await clienteDeTeste(REDIS.conexao());
    pool = new pg.Pool(BANCO.conexao());
    const leiloeiro = await inserirUsuario(pool, 'leiloeiro');
    loteId = (await inserirLote(pool, leiloeiro.id)).id;
  });

  beforeEach(async () => {
    await apagarChavesDoPrefixo(redis, prefixo);
  });

  afterAll(async () => {
    await apagarChavesDoPrefixo(redis, prefixo);
    redis.destroy();
    await pool.end();
    await app.close();
  });

  const get = (url: string): Promise<LightMyRequestResponse> =>
    app.inject({ method: 'GET', url, remoteAddress: '127.0.0.1' });
  const doLote = (id = loteId) => get(`/api/auditoria/lotes/${id}`);
  const chaves = () => get('/api/auditoria/chaves');

  function esperar429(resposta: LightMyRequestResponse): void {
    expect(resposta.statusCode).toBe(429);
    expect(resposta.json()).toMatchObject({
      sucesso: false,
      erro: { codigo: 'MUITAS_TENTATIVAS' },
    });
    const retryAfter = Number(resposta.headers['retry-after']);
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(JANELA_S);
    expect(resposta.headers['cache-control']).toBe('no-store');
  }

  it('a 600ª requisição ao lote passa e a 601ª recebe 429 com Retry-After e no-store', async () => {
    await redis.set(chave, String(TETO - 1), { EX: JANELA_S });

    expect((await doLote()).statusCode).toBe(200);
    esperar429(await doLote());
  });

  it('o mesmo teto vale em /chaves', async () => {
    await redis.set(chave, String(TETO - 1), { EX: JANELA_S });

    const ultima = await chaves();
    expect(ultima.statusCode).toBe(200);
    expect(ultima.headers['cache-control']).toBe('public, max-age=60');
    esperar429(await chaves());
  });

  it('as duas rotas dividem um contador só', async () => {
    await redis.set(chave, String(TETO - 1), { EX: JANELA_S });

    expect((await doLote()).statusCode).toBe(200);
    esperar429(await chaves());
    await redis.set(chave, String(TETO - 1), { EX: JANELA_S });
    expect((await chaves()).statusCode).toBe(200);
    esperar429(await doLote());

    expect(await redis.keys(`${prefixo}*`)).toEqual([chave]);
  });

  it('o 429 sai antes do banco: lote inexistente e bem formado também recebe 429', async () => {
    await redis.set(chave, String(TETO), { EX: JANELA_S });

    esperar429(await doLote(UUID_INEXISTENTE));
  });

  it(`${String(MALFORMADAS)} ids que não são UUID dão 404 sem tocar o contador`, async () => {
    await redis.set(chave, String(TETO - 1), { EX: JANELA_S });

    for (let i = 0; i < MALFORMADAS; i += 1) {
      const resposta = await doLote(`nao-e-uuid-${String(i)}`);
      expect(resposta.statusCode).toBe(404);
      expect(resposta.headers['cache-control']).toBe('no-store');
    }

    expect(await redis.get(chave)).toBe(String(TETO - 1));
    expect((await doLote()).statusCode).toBe(200);
  });

  it('UUID bem formado de lote inexistente dá 404 e consome o contador', async () => {
    await redis.set(chave, '10', { EX: JANELA_S });

    const resposta = await doLote(UUID_INEXISTENTE);

    expect(resposta.statusCode).toBe(404);
    expect(resposta.headers['cache-control']).toBe('no-store');
    expect(await redis.get(chave)).toBe('11');
  });
});
