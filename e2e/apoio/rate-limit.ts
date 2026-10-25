// Reset do rate limit entre os casos (specs/013 §"Rate limit e Redis nos testes"): o Redis de dev é
// compartilhado, então só as chaves `ratelimit:*` são apagadas, com SCAN + DEL. FLUSHDB e FLUSHALL
// são proibidos.
import { createRequire } from 'node:module';

import type { createClient as CriarCliente } from 'redis';

// `redis` é dependência da API, não da raiz: resolve a partir do pacote dela.
const daApi = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const { createClient } = daApi('redis') as { createClient: typeof CriarCliente };

const PADRAO = 'ratelimit:*';
const LOTE_DO_SCAN = 200;

function variavel(nome: string): string {
  const valor = process.env[nome];
  if (valor === undefined || valor === '') {
    throw new Error(`e2e: variável ${nome} ausente`);
  }
  return valor;
}

export async function limparRateLimit(): Promise<void> {
  const cliente = createClient({
    socket: { host: variavel('REDIS_HOST'), port: Number(variavel('REDIS_PORT')) },
    password: variavel('REDIS_PASSWORD'),
  });
  await cliente.connect();
  try {
    for await (const chaves of cliente.scanIterator({ MATCH: PADRAO, COUNT: LOTE_DO_SCAN })) {
      if (chaves.length > 0) {
        await cliente.del(chaves);
      }
    }
  } finally {
    cliente.destroy();
  }
}
