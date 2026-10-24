// Montagem da aplicação HTTP compartilhada por main.ts e pelos testes de integração.
import { randomUUID } from 'node:crypto';

import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Logger } from 'pino';

/** Prefixo de todas as rotas REST (specs/001: REST em /api). */
export const PREFIXO_DA_API = 'api';

/**
 * Adaptador Fastify com o logger Pino: cada requisição recebe um UUID novo, logado como
 * `requestId`. O cabeçalho `request-id` do cliente é ignorado (`requestIdHeader: false`) para que
 * ninguém forje a correlação dos logs.
 */
export function criarAdaptadorFastify(logger: Logger): FastifyAdapter {
  return new FastifyAdapter({
    loggerInstance: logger,
    requestIdHeader: false,
    requestIdLogLabel: 'requestId',
    genReqId: () => randomUUID(),
  });
}

export function configurarApp(app: NestFastifyApplication): void {
  app.setGlobalPrefix(PREFIXO_DA_API);
  app.enableShutdownHooks();
}
