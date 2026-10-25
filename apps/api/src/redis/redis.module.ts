// Cliente Redis como provider global do Nest (tarefa 017): criado no boot a partir do env
// validado e encerrado no shutdown, depois que o servidor HTTP para de aceitar requisições.
import {
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';

import { ENV, type Env } from '../config/env.js';
import { type ClienteRedis, criarClienteRedis } from './cliente.js';

/** Token de injeção do ClienteRedis. */
export const CLIENTE_REDIS = Symbol('CLIENTE_REDIS');

@Injectable()
class EncerramentoDoRedis implements OnApplicationShutdown {
  constructor(@Inject(CLIENTE_REDIS) private readonly redis: ClienteRedis) {}

  async onApplicationShutdown(): Promise<void> {
    await this.redis.encerrar();
  }
}

function criarClienteDoEnv(env: Env): ClienteRedis {
  const logger = new Logger('Redis');
  return criarClienteRedis({
    conexao: env.redis,
    // ErroDoRedis só leva tipo e código: a mensagem é segura para o log.
    aoErro: (erro) => logger.warn(`conexão com o Redis falhou: ${erro.message}`),
  });
}

@Global()
@Module({
  providers: [
    { provide: CLIENTE_REDIS, inject: [ENV], useFactory: criarClienteDoEnv },
    EncerramentoDoRedis,
  ],
  exports: [CLIENTE_REDIS],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- módulo Nest: o conteúdo vem do decorator
export class RedisModule {}
