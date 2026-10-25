// Adapter Redis do Socket.IO (specs/009: escalar na horizontal no futuro). Criado no boot, com os
// clientes pub/sub duplicados do cliente da API. Se o Redis não estiver de pé no boot, a API sobe
// com o adapter em memória (uma instância, como na e2-micro) e avisa no log; falha de Redis não
// derruba a API (specs/001 §Erros).
import { Logger } from '@nestjs/common';
import { createAdapter } from '@socket.io/redis-adapter';

import { TEMPO_LIMITE_DE_CONEXAO_DO_REDIS_MS, type ComandosDePubSub } from '../../redis/cliente.js';
import type { ClientesPubSub } from '../../redis/clientes-pubsub.js';

/** Token de injeção do AdapterRedisDoTempoReal. */
export const ADAPTER_REDIS_DO_TEMPO_REAL = Symbol('ADAPTER_REDIS_DO_TEMPO_REAL');

type FabricaDoAdapter = ReturnType<typeof createAdapter>;

export interface AdapterRedisDoTempoReal {
  /** `undefined` quando o Redis não ficou pronto no boot: vale o adapter em memória. */
  readonly fabrica: FabricaDoAdapter | undefined;
  encerrar(): Promise<void>;
}

const SEM_ADAPTER: AdapterRedisDoTempoReal = {
  fabrica: undefined,
  encerrar: () => Promise.resolve(),
};

/** Nunca lança nem rejeita: qualquer falha vira "sem adapter" e um aviso só com o nome do erro. */
export async function criarAdapterRedis(
  redis: ComandosDePubSub,
  logger: Logger = new Logger('TempoReal'),
): Promise<AdapterRedisDoTempoReal> {
  let clientes: ClientesPubSub;
  try {
    clientes = redis.duplicarParaPubSub();
  } catch (erro: unknown) {
    const nome = erro instanceof Error ? erro.name : 'ErroDesconhecido';
    logger.warn(`adapter Redis do Socket.IO indisponível (${nome}); usando o adapter em memória`);
    return SEM_ADAPTER;
  }
  const prontos = await clientes.aguardarConexao(
    AbortSignal.timeout(TEMPO_LIMITE_DE_CONEXAO_DO_REDIS_MS),
  );
  if (!prontos) {
    await clientes.encerrar();
    logger.warn('Redis fora no boot; o Socket.IO usa o adapter em memória');
    return SEM_ADAPTER;
  }
  return { fabrica: createAdapter(clientes.pub, clientes.sub), encerrar: clientes.encerrar };
}
