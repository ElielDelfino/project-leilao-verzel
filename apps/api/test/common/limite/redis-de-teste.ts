// Cliente Redis auxiliar dos testes de rate limit. O reset apaga só as chaves de um prefixo, com
// SCAN (MATCH <prefixo>*) + DEL; FLUSHDB e FLUSHALL são proibidos (specs/013 §Rate limit e Redis).
import { createClient } from 'redis';

import type { ConexaoDoRedis } from '../../../src/redis/conexao.js';

export async function clienteDeTeste(conexao: ConexaoDoRedis) {
  const cliente = createClient({
    socket: { host: conexao.host, port: conexao.port },
    password: conexao.password,
  });
  cliente.on('error', () => undefined);
  await cliente.connect();
  return cliente;
}

type ClienteDeTeste = Awaited<ReturnType<typeof clienteDeTeste>>;

export async function apagarChavesDoPrefixo(
  cliente: ClienteDeTeste,
  prefixo: string,
): Promise<void> {
  if (!prefixo.startsWith('ratelimit:') || prefixo === 'ratelimit:') {
    throw new Error('o reset dos testes só apaga um prefixo próprio sob ratelimit:');
  }
  for await (const chaves of cliente.scanIterator({ MATCH: `${prefixo}*`, COUNT: 100 })) {
    if (chaves.length > 0) {
      await cliente.del(chaves);
    }
  }
}

export function ttlDe(cliente: ClienteDeTeste, chave: string): Promise<number> {
  return cliente.ttl(chave);
}
