// Provider do cliente da Scryfall, interno ao módulo catalogo. Usa o cliente Redis único da API
// (RedisModule, tarefa 047): nenhum outro cliente Redis é criado aqui.
import type { Provider } from '@nestjs/common';

import { ENV, type Env } from '../../../config/env.js';
import type { ClienteRedisComCatalogo } from '../../../redis/cliente.js';
import { CLIENTE_REDIS } from '../../../redis/redis.module.js';
import { type ClienteScryfall, criarClienteScryfall } from './cliente-scryfall.js';

/** Token de injeção do ClienteScryfall (só dentro do módulo catalogo). */
export const CLIENTE_SCRYFALL = Symbol('CLIENTE_SCRYFALL');

export const provedorDoClienteScryfall: Provider<ClienteScryfall> = {
  provide: CLIENTE_SCRYFALL,
  inject: [ENV, CLIENTE_REDIS],
  useFactory: (env: Env, redis: ClienteRedisComCatalogo): ClienteScryfall =>
    criarClienteScryfall({ redis, config: env.scryfall }),
};
