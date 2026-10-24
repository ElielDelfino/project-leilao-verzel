// Montagem da aplicação HTTP compartilhada por main.ts (via servidor.ts) e pelos testes.
import { randomUUID } from 'node:crypto';

import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { LogController } from 'fastify';
import type { Logger } from 'pino';

/** Prefixo de todas as rotas REST (specs/001: REST em /api). */
export const PREFIXO_DA_API = 'api';

/** Nome do campo de correlação nos logs (ADR 0018). */
export const ROTULO_DO_REQUEST_ID = 'requestId';

/**
 * Adaptador Fastify com o logger Pino: cada requisição recebe um UUID novo, logado como
 * `requestId`. O cabeçalho `request-id` do cliente é ignorado (`requestIdHeader: false`) para que
 * ninguém forje a correlação dos logs.
 */
export function criarAdaptadorFastify(logger: Logger): FastifyAdapter {
  return new FastifyAdapter({
    loggerInstance: logger,
    logController: new LogController({ requestIdLogLabel: ROTULO_DO_REQUEST_ID }),
    requestIdHeader: false,
    genReqId: () => randomUUID(),
  });
}

export function configurarApp(app: NestFastifyApplication): void {
  app.setGlobalPrefix(PREFIXO_DA_API);
  app.enableShutdownHooks();
}
