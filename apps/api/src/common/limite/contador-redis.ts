// Contador do rate limit no Redis (specs/003 §Rate limit): INCR, EXPIRE <janela> NX e TTL num
// MULTI, então a contagem e a expiração são atômicas. Usa o cliente Redis único da API
// (CLIENTE_REDIS, src/redis/cliente.ts), sem fila offline: com o Redis fora, a contagem rejeita na
// hora e o login/cadastro responde 500 INDISPONIVEL (falha fechada, specs/001 §Erros).
import type { ClienteRedisDaApi } from '../../redis/cliente.js';
import type { ContadorDeJanela } from './limite-de-tentativas.js';

export function criarContadorRedis(
  redis: Pick<ClienteRedisDaApi, 'incrementarNaJanela'>,
): ContadorDeJanela {
  return { incrementar: (chave, janelaS) => redis.incrementarNaJanela(chave, janelaS) };
}
