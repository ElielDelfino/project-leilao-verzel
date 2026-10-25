// Comandos do ClienteRedisDaApi usados pelo catálogo (tarefa 054): GET, SET PX, PTTL e EVAL.
// Toda chave criada aqui tem TTL de poucos segundos: não sobra nada no Redis compartilhado.
import { randomBytes } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type ClienteRedisComCatalogo,
  criarClienteRedis,
  ErroDoRedis,
} from '../../src/redis/cliente.js';
import { criarConexaoDoRedis } from '../../src/redis/conexao.js';
import { portaFechada } from '../helpers/porta-fechada.js';
import { ambienteDoRedis } from './ambiente-de-teste.js';

const ambiente = ambienteDoRedis(process.env);

describe('comandos do catálogo com o Redis fora', () => {
  it('obter, gravarComTtl, ttlRestanteMs e executarLua rejeitam com ErroDoRedis', async () => {
    const porta = await portaFechada();
    const senha = randomBytes(32).toString('base64url');
    const redis = criarClienteRedis({
      conexao: criarConexaoDoRedis({ host: '127.0.0.1', port: porta }, senha),
      aoErro: () => undefined,
    });
    try {
      const falhas = await Promise.all([
        redis.obter('k').catch((e: unknown) => e),
        redis.gravarComTtl('k', 'v', 1000).catch((e: unknown) => e),
        redis.ttlRestanteMs('k').catch((e: unknown) => e),
        redis.executarLua('return 1', ['k'], []).catch((e: unknown) => e),
      ]);
      for (const falha of falhas) {
        expect(falha).toBeInstanceOf(ErroDoRedis);
        expect(String((falha as Error).message)).not.toContain(String(porta));
      }
    } finally {
      await redis.encerrar();
    }
  });
});

describe.skipIf(!ambiente.disponivel)('comandos do catálogo contra o Redis real', () => {
  const prefixo = `teste:054:redis:${randomBytes(6).toString('hex')}:`;
  let redis: ClienteRedisComCatalogo;

  beforeAll(async () => {
    redis = criarClienteRedis({ conexao: ambiente.conexao(), aoErro: () => undefined });
    await redis.aguardarConexao(AbortSignal.timeout(2_000));
  });

  afterAll(async () => {
    await redis.encerrar();
  });

  it('gravarComTtl grava com TTL em ms; obter lê; ttlRestanteMs devolve o restante', async () => {
    await redis.gravarComTtl(`${prefixo}a`, 'valor', 5_000);

    expect(await redis.obter(`${prefixo}a`)).toBe('valor');
    const ttl = await redis.ttlRestanteMs(`${prefixo}a`);
    expect(ttl).toBeGreaterThan(4_000);
    expect(ttl).toBeLessThanOrEqual(5_000);
  });

  it('chave ausente: obter devolve null e ttlRestanteMs devolve -2', async () => {
    expect(await redis.obter(`${prefixo}nada`)).toBeNull();
    expect(await redis.ttlRestanteMs(`${prefixo}nada`)).toBe(-2);
  });

  it('executarLua recebe KEYS e ARGV e devolve o resultado', async () => {
    const resultado = await redis.executarLua(
      "redis.call('SET', KEYS[1], ARGV[1], 'PX', 5000) return redis.call('GET', KEYS[1])",
      [`${prefixo}lua`],
      ['42'],
    );

    expect(resultado).toBe('42');
  });

  it('erro do script vira ErroDoRedis', async () => {
    await expect(
      redis.executarLua("return redis.call('NAOEXISTE')", [], []),
    ).rejects.toBeInstanceOf(ErroDoRedis);
  });
});
