// Integração (Redis real): contador de janela fixa do rate limit (specs/003 §Rate limit), feito
// pelo cliente Redis único da API (src/redis/cliente.ts, tarefa 047).
// Usa um prefixo próprio sob ratelimit: e apaga só as próprias chaves (SCAN + DEL), nunca FLUSHDB.
import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { criarContadorRedis } from '../../../src/common/limite/contador-redis.js';
import type { ContadorDeJanela } from '../../../src/common/limite/limite-de-tentativas.js';
import { type ClienteRedisDaApi, criarClienteRedis } from '../../../src/redis/cliente.js';
import { criarConexaoDoRedis } from '../../../src/redis/conexao.js';
import { portaFechada } from '../../helpers/porta-fechada.js';
import { ambienteDoRedis } from '../../redis/ambiente-de-teste.js';
import { apagarChavesDoPrefixo, clienteDeTeste, ttlDe } from './redis-de-teste.js';

const redis = ambienteDoRedis(process.env);

describe.skipIf(!redis.disponivel)('criarContadorRedis com Redis real', () => {
  const prefixo = `ratelimit:teste-${randomUUID()}:`;
  let cliente: ClienteRedisDaApi;
  let contador: ContadorDeJanela;
  let auxiliar: Awaited<ReturnType<typeof clienteDeTeste>>;

  beforeAll(async () => {
    cliente = criarClienteRedis({ conexao: redis.conexao(), aoErro: () => undefined });
    await cliente.aguardarConexao(AbortSignal.timeout(5_000));
    contador = criarContadorRedis(cliente);
    auxiliar = await clienteDeTeste(redis.conexao());
  });

  afterEach(async () => {
    await apagarChavesDoPrefixo(auxiliar, prefixo);
  });

  afterAll(async () => {
    await cliente.encerrar();
    auxiliar.destroy();
  });

  it('INCR conta a cada chamada e a chave expira em 60 s', async () => {
    const chave = `${prefixo}cadastro:10.0.0.1`;

    const primeira = await contador.incrementar(chave, 60);
    const segunda = await contador.incrementar(chave, 60);

    expect(primeira.contagem).toBe(1);
    expect(segunda.contagem).toBe(2);
    expect(segunda.ttlS).toBeGreaterThanOrEqual(1);
    expect(segunda.ttlS).toBeLessThanOrEqual(60);
    expect(await ttlDe(auxiliar, chave)).toBeGreaterThan(0);
  });

  it('EXPIRE NX: incrementar de novo não renova a janela', async () => {
    const chave = `${prefixo}login:x`;
    await contador.incrementar(chave, 60);
    await auxiliar.expire(chave, 5);

    const depois = await contador.incrementar(chave, 60);

    expect(depois.ttlS).toBeLessThanOrEqual(5);
  });

  it('o reset apaga só as chaves do prefixo do teste', async () => {
    const outra = `ratelimit:outro-${randomUUID()}:x`;
    await auxiliar.set(outra, '1', { EX: 60 });
    await contador.incrementar(`${prefixo}a`, 60);

    await apagarChavesDoPrefixo(auxiliar, prefixo);

    expect(await auxiliar.exists(`${prefixo}a`)).toBe(0);
    expect(await auxiliar.exists(outra)).toBe(1);
    await auxiliar.del(outra);
  });
});

describe('criarContadorRedis com o Redis fora', () => {
  it('falha na hora (sem fila offline) com ErroDoRedis, sem host nem senha', async () => {
    const porta = await portaFechada();
    const senha = 'senha-do-redis-que-nao-vaza-123456789012345';
    const cliente = criarClienteRedis({
      conexao: criarConexaoDoRedis({ host: '127.0.0.1', port: porta }, senha),
      aoErro: () => undefined,
    });
    try {
      const falha = await criarContadorRedis(cliente)
        .incrementar('ratelimit:x', 60)
        .catch((erro: unknown) => erro);

      expect(falha).toMatchObject({ name: 'ErroDoRedis' });
      expect(String((falha as Error).message)).not.toContain('127.0.0.1');
      expect(String((falha as Error).message)).not.toContain(senha);
    } finally {
      await cliente.encerrar();
    }
  });
});
