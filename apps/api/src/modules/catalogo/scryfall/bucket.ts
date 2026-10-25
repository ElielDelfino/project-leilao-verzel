// Token bucket global da Scryfall (specs/005 §Cliente HTTP, bucket e circuito): capacidade de
// 1 ficha, sem rajada, uma ficha a cada `intervaloMs`. Implementado como reserva de horário (GCRA,
// equivalente a um token bucket de capacidade 1): a chave guarda o instante, no relógio do Redis,
// em que a próxima ficha fica livre. O script atômico reserva esse instante para quem chegou e
// empurra o próximo em `intervaloMs`; quem chega devolve quanto precisa esperar. Assim, duas
// chamadas ao upstream de um mesmo bucket nunca começam a menos de `intervaloMs` uma da outra,
// em todos os processos da API, porque o relógio é o do Redis.
import type { ComandosDoCatalogoNoRedis } from '../../../redis/cliente.js';

/** -1 = sem ficha dentro da espera máxima; ≥ 0 = ficha reservada após esse tanto de ms. */
const SCRIPT_RESERVAR_FICHA = `
local t = redis.call('TIME')
local agora = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local intervalo = tonumber(ARGV[1])
local esperaMaxima = tonumber(ARGV[2])
local livre = tonumber(redis.call('GET', KEYS[1]) or '0')
if livre < agora then livre = agora end
local espera = livre - agora
if espera > esperaMaxima then return -1 end
redis.call('SET', KEYS[1], tostring(livre + intervalo), 'PX', espera + intervalo)
return espera
`;

export type RedisDoBucket = Pick<ComandosDoCatalogoNoRedis, 'executarLua'>;

/**
 * Reserva uma ficha e espera até ela valer. Devolve `false` se a ficha só ficaria livre depois de
 * `esperaMaximaMs` (nada é reservado nesse caso). Falha do Redis propaga como ErroDoRedis.
 */
export async function aguardarFicha(
  redis: RedisDoBucket,
  chave: string,
  intervaloMs: number,
  esperaMaximaMs: number,
): Promise<boolean> {
  const espera = await redis.executarLua(
    SCRIPT_RESERVAR_FICHA,
    [chave],
    [String(intervaloMs), String(esperaMaximaMs)],
  );
  if (typeof espera !== 'number' || espera < 0) {
    return false;
  }
  if (espera > 0) {
    await new Promise((resolver) => setTimeout(resolver, espera));
  }
  return true;
}
