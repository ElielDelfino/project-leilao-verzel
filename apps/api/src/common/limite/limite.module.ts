// Rate limit como provider global (specs/003 §Rate limit): o contador usa o cliente Redis único
// da API (CLIENTE_REDIS, do RedisModule global, que também o fecha no shutdown). O prefixo das
// chaves é injetável (os testes usam um prefixo próprio sob `ratelimit:` e apagam só as próprias
// chaves; specs/013).
import { Global, Module } from '@nestjs/common';

import type { ClienteRedisDaApi } from '../../redis/cliente.js';
import { CLIENTE_REDIS } from '../../redis/redis.module.js';
import { criarContadorRedis } from './contador-redis.js';
import {
  type ContadorDeJanela,
  LimiteDeTentativas,
  PREFIXO_PADRAO_DO_LIMITE,
} from './limite-de-tentativas.js';

/** Token do ContadorDeJanela (o Redis em produção). */
export const CONTADOR_DE_JANELA = Symbol('CONTADOR_DE_JANELA');
/** Token do prefixo das chaves (padrão `ratelimit:`). */
export const PREFIXO_DO_LIMITE = Symbol('PREFIXO_DO_LIMITE');

@Global()
@Module({
  providers: [
    {
      provide: CONTADOR_DE_JANELA,
      inject: [CLIENTE_REDIS],
      useFactory: (redis: ClienteRedisDaApi) => criarContadorRedis(redis),
    },
    { provide: PREFIXO_DO_LIMITE, useValue: PREFIXO_PADRAO_DO_LIMITE },
    {
      provide: LimiteDeTentativas,
      inject: [CONTADOR_DE_JANELA, PREFIXO_DO_LIMITE],
      useFactory: (contador: ContadorDeJanela, prefixo: string) =>
        new LimiteDeTentativas(contador, prefixo),
    },
  ],
  exports: [LimiteDeTentativas],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- módulo Nest: o conteúdo vem do decorator
export class LimiteModule {}
