// Provider do cliente da Scryfall: monta com o ENV e o cliente Redis único (CLIENTE_REDIS) e usa o
// prefixo Redis do ENV (`scryfall:` em produção; próprio por app nos testes, tarefa 067).
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { ENV, type Env } from '../../../../src/config/env.js';
import {
  CLIENTE_SCRYFALL,
  provedorDoClienteScryfall,
} from '../../../../src/modules/catalogo/scryfall/scryfall.provider.js';
import type { ClienteScryfall } from '../../../../src/modules/catalogo/scryfall/cliente-scryfall.js';
import type { ClienteRedisComCatalogo } from '../../../../src/redis/cliente.js';
import { CLIENTE_REDIS } from '../../../../src/redis/redis.module.js';
import { ENV_DE_TESTE, redisFalso } from '../../../helpers/app-de-teste.js';

const ID_CARTA = '11111111-1111-4111-8111-111111111111';

async function montar(
  env: Env,
  redis: ClienteRedisComCatalogo,
): Promise<{ cliente: ClienteScryfall; fechar: () => Promise<void> }> {
  const modulo = await Test.createTestingModule({
    providers: [
      provedorDoClienteScryfall,
      { provide: ENV, useValue: env },
      { provide: CLIENTE_REDIS, useValue: redis },
    ],
  }).compile();
  return { cliente: modulo.get<ClienteScryfall>(CLIENTE_SCRYFALL), fechar: () => modulo.close() };
}

/** Redis falso que registra as chaves lidas do cache (e rejeita, como o Redis fora). */
function redisQueRegistraChaves(): { redis: ClienteRedisComCatalogo; chaves: string[] } {
  const chaves: string[] = [];
  const base = redisFalso();
  const redis: ClienteRedisComCatalogo = {
    ...base,
    obter: (chave: string) => {
      chaves.push(chave);
      return base.obter(chave);
    },
  };
  return { redis, chaves };
}

describe('provedorDoClienteScryfall', () => {
  it('cria o ClienteScryfall a partir do ENV e do CLIENTE_REDIS injetados', async () => {
    const { cliente, fechar } = await montar(ENV_DE_TESTE, redisFalso());

    expect(typeof cliente.buscar).toBe('function');
    expect(typeof cliente.obterCarta).toBe('function');
    await fechar();
  });

  it.each(['scryfall:', 'scryfall:t123-abc:'])(
    'usa env.scryfall.prefixoRedis (%s) nas chaves do cache',
    async (prefixoRedis) => {
      const env: Env = { ...ENV_DE_TESTE, scryfall: { ...ENV_DE_TESTE.scryfall, prefixoRedis } };
      const { redis, chaves } = redisQueRegistraChaves();
      const { cliente, fechar } = await montar(env, redis);

      await expect(cliente.obterCarta(ID_CARTA)).rejects.toBeDefined();

      expect(chaves).toEqual([`${prefixoRedis}carta:${ID_CARTA}`]);
      await fechar();
    },
  );
});
