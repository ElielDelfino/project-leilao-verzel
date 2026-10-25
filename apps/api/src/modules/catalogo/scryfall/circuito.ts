// Circuito da Scryfall (specs/005 §Cliente HTTP, bucket e circuito). O estado aberto fica no
// Redis (`scryfall:circuito`, TTL = tempo de abertura), compartilhado por todos os processos. O
// contador de falhas seguidas fica na memória do processo, como a spec define: cada processo conta
// as próprias falhas, e qualquer sucesso zera a contagem dele.
import type { ComandosDoCatalogoNoRedis } from '../../../redis/cliente.js';

export type RedisDoCircuito = Pick<ComandosDoCatalogoNoRedis, 'gravarComTtl' | 'ttlRestanteMs'>;

/** PTTL de chave sem expiração (não deveria acontecer; tratada como aberta). */
const SEM_EXPIRACAO = -1;

export interface Circuito {
  /** Milissegundos até fechar; 0 se fechado. */
  restanteMs(): Promise<number>;
  /** Abre por `aberturaMs` (429 do upstream). */
  abrir(): Promise<void>;
  /** Conta uma falha (timeout, rede ou 5xx depois do retry). Devolve true se abriu. */
  registrarFalha(): Promise<boolean>;
  registrarSucesso(): void;
}

export function criarCircuito(
  redis: RedisDoCircuito,
  chave: string,
  aberturaMs: number,
  falhasParaAbrir: number,
): Circuito {
  let falhasSeguidas = 0;
  const abrir = async (): Promise<void> => {
    falhasSeguidas = 0;
    await redis.gravarComTtl(chave, '1', aberturaMs);
  };
  return {
    restanteMs: async () => {
      const ttl = await redis.ttlRestanteMs(chave);
      if (ttl === SEM_EXPIRACAO) return aberturaMs;
      return Math.max(0, ttl);
    },
    abrir,
    registrarFalha: async () => {
      falhasSeguidas += 1;
      if (falhasSeguidas < falhasParaAbrir) return false;
      await abrir();
      return true;
    },
    registrarSucesso: () => {
      falhasSeguidas = 0;
    },
  };
}
