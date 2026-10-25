import { describe, expect, it, vi } from 'vitest';

import type { ComandosDePubSub } from '../../../src/redis/cliente.js';
import type { ClientesPubSub } from '../../../src/redis/clientes-pubsub.js';
import { criarAdapterRedis } from '../../../src/modules/tempo-real/adapter-redis.js';

// Sem Redis no boot a API sobe com o adapter em memória (specs/001 §Erros; tarefa 082).

function loggerFalso(): { warn: ReturnType<typeof vi.fn> } {
  return { warn: vi.fn() };
}

function clientesFalsos(pronto: boolean): ClientesPubSub & { encerrar: ReturnType<typeof vi.fn> } {
  return {
    pub: {},
    sub: {},
    aguardarConexao: () => Promise.resolve(pronto),
    encerrar: vi.fn(() => Promise.resolve()),
  };
}

describe('criarAdapterRedis', () => {
  it('duplicarParaPubSub lançando → sem adapter e aviso só com o nome do erro', async () => {
    const logger = loggerFalso();
    const redis: ComandosDePubSub = {
      duplicarParaPubSub: () => {
        throw new TypeError('senha=segredo-que-nao-pode-vazar');
      },
    };

    const adapter = await criarAdapterRedis(redis, logger as never);

    expect(adapter.fabrica).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(String(logger.warn.mock.calls[0]?.[0])).toContain('TypeError');
    expect(String(logger.warn.mock.calls[0]?.[0])).not.toContain('segredo');
    await expect(adapter.encerrar()).resolves.toBeUndefined();
  });

  it('Redis que não ficou pronto → fecha os clientes e usa o adapter em memória', async () => {
    const logger = loggerFalso();
    const clientes = clientesFalsos(false);

    const adapter = await criarAdapterRedis(
      { duplicarParaPubSub: () => clientes },
      logger as never,
    );

    expect(adapter.fabrica).toBeUndefined();
    expect(clientes.encerrar).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('Redis pronto → fábrica do adapter e encerrar fecha os clientes', async () => {
    const logger = loggerFalso();
    const clientes = clientesFalsos(true);

    const adapter = await criarAdapterRedis(
      { duplicarParaPubSub: () => clientes },
      logger as never,
    );

    expect(typeof adapter.fabrica).toBe('function');
    await adapter.encerrar();
    expect(clientes.encerrar).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
