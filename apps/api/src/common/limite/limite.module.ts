// Rate limit como provider global (specs/003 §Rate limit): o contador Redis é criado no boot a
// partir do env validado e fechado no shutdown. O prefixo das chaves é injetável (os testes usam
// um prefixo próprio sob `ratelimit:` e apagam só as próprias chaves; specs/013).
import {
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';

import { ENV, type Env } from '../../config/env.js';
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

/** O que o encerramento usa: só contadores com `encerrar` (o Redis) precisam fechar. */
interface ComEncerrar {
  encerrar?: () => Promise<void>;
}

@Injectable()
class EncerramentoDoContador implements OnApplicationShutdown {
  constructor(@Inject(CONTADOR_DE_JANELA) private readonly contador: ContadorDeJanela) {}

  async onApplicationShutdown(): Promise<void> {
    await (this.contador as ContadorDeJanela & ComEncerrar).encerrar?.();
  }
}

function criarContadorDoEnv(env: Env): ContadorDeJanela {
  const logger = new Logger('RateLimit');
  return criarContadorRedis({
    conexao: env.redis,
    // ErroDoRedis só leva tipo e código: a mensagem é segura para o log.
    aoErro: (erro) => logger.warn(`conexão com o Redis do rate limit falhou: ${erro.message}`),
  });
}

@Global()
@Module({
  providers: [
    { provide: CONTADOR_DE_JANELA, inject: [ENV], useFactory: criarContadorDoEnv },
    { provide: PREFIXO_DO_LIMITE, useValue: PREFIXO_PADRAO_DO_LIMITE },
    {
      provide: LimiteDeTentativas,
      inject: [CONTADOR_DE_JANELA, PREFIXO_DO_LIMITE],
      useFactory: (contador: ContadorDeJanela, prefixo: string) =>
        new LimiteDeTentativas(contador, prefixo),
    },
    EncerramentoDoContador,
  ],
  exports: [LimiteDeTentativas],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- módulo Nest: o conteúdo vem do decorator
export class LimiteModule {}
