// Cache-Control: no-store em toda resposta das rotas de comprovante, inclusive 401, 403, 404, 422,
// 429 e 503 (specs/011). Middleware roda antes do guard global, então o header já está na
// resposta quando o filtro de exceções responde; o Fastify preserva os headers já gravados.
import type { IncomingMessage, ServerResponse } from 'node:http';

import { Injectable, type NestMiddleware } from '@nestjs/common';

const SEM_CACHE = 'no-store';

@Injectable()
export class SemCacheMiddleware implements NestMiddleware {
  use(_requisicao: IncomingMessage, resposta: ServerResponse, proximo: () => void): void {
    resposta.setHeader('cache-control', SEM_CACHE);
    proximo();
  }
}
