import { describe, expect, it, vi } from 'vitest';

import type { Banco } from '../../src/db/banco.js';
import { verificacaoDoPostgres, verificacaoDoRedis } from '../../src/health/verificacoes.js';
import type { ClienteRedis } from '../../src/redis/cliente.js';

function bancoFalso(consultar: Banco['consultar']): Banco {
  return { consultar, transaction: vi.fn(), encerrar: vi.fn(async () => {}) };
}

describe('verificacaoDoPostgres (SELECT 1 pelo pool, specs/014 §Observabilidade)', () => {
  it('chama-se "postgres" e resolve quando a consulta responde', async () => {
    const execute = vi.fn(async () => ({ rows: [{ '?column?': 1 }] }));
    const consultar = vi.fn(async (fn: (db: never) => Promise<unknown>) =>
      fn({ execute } as never),
    ) as unknown as Banco['consultar'];
    const verificacao = verificacaoDoPostgres(bancoFalso(consultar));

    await expect(verificacao.verificar(new AbortController().signal)).resolves.toBeUndefined();

    expect(verificacao.nome).toBe('postgres');
    expect(consultar).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('rejeita quando o banco rejeita', async () => {
    const falha = new Error('fora');
    const verificacao = verificacaoDoPostgres(bancoFalso(() => Promise.reject(falha)));

    await expect(verificacao.verificar(new AbortController().signal)).rejects.toBe(falha);
  });

  it('com o sinal já abortado, não abre consulta', async () => {
    const consultar = vi.fn() as unknown as Banco['consultar'];
    const verificacao = verificacaoDoPostgres(bancoFalso(consultar));

    await expect(verificacao.verificar(AbortSignal.abort(new Error('tempo')))).rejects.toThrow(
      'tempo',
    );
    expect(consultar).not.toHaveBeenCalled();
  });
});

describe('verificacaoDoRedis (PING, specs/014 §Observabilidade)', () => {
  it('chama-se "redis" e repassa o sinal ao PING', async () => {
    const ping = vi.fn(async () => {});
    const redis: ClienteRedis = { ping, encerrar: vi.fn(async () => {}) };
    const sinal = new AbortController().signal;
    const verificacao = verificacaoDoRedis(redis);

    await verificacao.verificar(sinal);

    expect(verificacao.nome).toBe('redis');
    expect(ping).toHaveBeenCalledWith(sinal);
  });
});
