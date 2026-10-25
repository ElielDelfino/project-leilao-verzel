// Verificações reais do /api/health/ready (specs/014 §Observabilidade: Postgres + Redis).
import type { BancoVerificavel } from '../db/banco.js';
import type { ClienteRedis } from '../redis/cliente.js';
import type { VerificacaoDeProntidao } from './prontidao.js';

/**
 * SELECT 1 por banco.verificar (db/banco.ts, tarefa 037): com o sinal do tempo limite, a consulta
 * é cancelada no servidor e a conexão descartada.
 */
export function verificacaoDoPostgres(banco: BancoVerificavel): VerificacaoDeProntidao {
  return { nome: 'postgres', verificar: (sinal) => banco.verificar(sinal) };
}

/** PING com o sinal do tempo limite, que cancela o comando ainda na fila do cliente. */
export function verificacaoDoRedis(redis: ClienteRedis): VerificacaoDeProntidao {
  return { nome: 'redis', verificar: (sinal) => redis.ping(sinal) };
}
