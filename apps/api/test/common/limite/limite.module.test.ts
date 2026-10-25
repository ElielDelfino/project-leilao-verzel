// Unidade: o LimiteModule conta pelo cliente Redis único da API (CLIENTE_REDIS), sem abrir um
// cliente próprio (tarefa 047).
import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';

import { LimiteDeTentativas } from '../../../src/common/limite/limite-de-tentativas.js';
import { LimiteModule } from '../../../src/common/limite/limite.module.js';
import type { ClienteRedisDaApi } from '../../../src/redis/cliente.js';
import { CLIENTE_REDIS } from '../../../src/redis/redis.module.js';

function redisFalso(): ClienteRedisDaApi {
  return {
    ping: vi.fn(() => Promise.resolve()),
    encerrar: vi.fn(() => Promise.resolve()),
    aguardarConexao: vi.fn(() => Promise.resolve()),
    incrementarNaJanela: vi.fn(() => Promise.resolve({ contagem: 1, ttlS: 60 })),
  };
}

describe('LimiteModule', () => {
  it('incrementa pelo CLIENTE_REDIS, com o prefixo padrão e a janela de 60 s', async () => {
    const redis = redisFalso();
    @Global()
    @Module({ providers: [{ provide: CLIENTE_REDIS, useValue: redis }], exports: [CLIENTE_REDIS] })
    // eslint-disable-next-line @typescript-eslint/no-extraneous-class -- módulo Nest de teste
    class RedisFalsoModule {}
    const modulo = await Test.createTestingModule({
      imports: [RedisFalsoModule, LimiteModule],
    }).compile();

    await modulo.get(LimiteDeTentativas).consumir('login:10.0.0.1');

    expect(redis.incrementarNaJanela).toHaveBeenCalledWith('ratelimit:login:10.0.0.1', 60);
    await modulo.close();
  });
});
