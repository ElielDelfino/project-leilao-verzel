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
import {
  type ClienteRedis,
  type ClienteRedisDaApi,
  criarClienteRedis,
  TEMPO_LIMITE_DE_CONEXAO_DO_REDIS_MS,
} from './cliente.js';

/** Token de injeção do ClienteRedisDaApi, o único cliente Redis da API. */
export const CLIENTE_REDIS = Symbol('CLIENTE_REDIS');

@Injectable()
class EncerramentoDoRedis implements OnApplicationShutdown {
  constructor(@Inject(CLIENTE_REDIS) private readonly redis: ClienteRedis) {}

  async onApplicationShutdown(): Promise<void> {
    await this.redis.encerrar();
  }
}

/**
 * Cria o cliente único da API e espera a primeira conexão (ou a primeira falha, ou o tempo limite
 * de conexão) antes de o boot seguir: sem fila offline, um login logo depois do `listen` cairia no
 * 500 INDISPONIVEL só porque a conexão ainda não estava pronta. Com o Redis fora, o boot segue.
 */
async function criarClienteDoEnv(env: Env): Promise<ClienteRedisDaApi> {
  const logger = new Logger('Redis');
  const cliente = criarClienteRedis({
    conexao: env.redis,
    // ErroDoRedis só leva tipo e código: a mensagem é segura para o log.
    aoErro: (erro) => logger.warn(`conexão com o Redis falhou: ${erro.message}`),
  });
  await cliente.aguardarConexao(AbortSignal.timeout(TEMPO_LIMITE_DE_CONEXAO_DO_REDIS_MS));
  return cliente;
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
