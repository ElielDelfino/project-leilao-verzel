// Verificações reais do /api/health/ready (specs/014 §Observabilidade: Postgres + Redis).
import { sql } from 'drizzle-orm';

import type { Banco } from '../db/banco.js';
import type { ClienteRedis } from '../redis/cliente.js';
import type { VerificacaoDeProntidao } from './prontidao.js';

/**
 * SELECT 1 pelo pool da API (db/banco.ts). O Banco ainda não aceita AbortSignal: o sinal só
 * impede abrir a consulta depois do tempo limite. Uma consulta já em curso fica limitada pelos
 * limites do pool (connectionTimeoutMillis de 5 s; statement_timeout de 10 s no servidor).
 */
export function verificacaoDoPostgres(banco: Banco): VerificacaoDeProntidao {
  return {
    nome: 'postgres',
    verificar: async (sinal) => {
      sinal.throwIfAborted();
      await banco.consultar((db) => db.execute(sql`select 1`));
    },
  };
}

/** PING com o sinal do tempo limite, que cancela o comando ainda na fila do cliente. */
export function verificacaoDoRedis(redis: ClienteRedis): VerificacaoDeProntidao {
  return { nome: 'redis', verificar: (sinal) => redis.ping(sinal) };
}
