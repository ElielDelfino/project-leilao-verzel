// Montagem da aplicação HTTP compartilhada por main.ts (via servidor.ts) e pelos testes.
import { randomUUID } from 'node:crypto';

import fastifyCookie from '@fastify/cookie';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { LogController } from 'fastify';
import type { Logger } from 'pino';

import { responderErroDoRoteador } from './common/erros/erros-do-roteador.js';

/** Prefixo de todas as rotas REST (specs/001: REST em /api). */
export const PREFIXO_DA_API = 'api';

/** Nome do campo de correlação nos logs (ADR 0018). */
export const ROTULO_DO_REQUEST_ID = 'requestId';

/**
 * Adaptador Fastify com o logger Pino: cada requisição recebe um UUID novo, logado como
 * `requestId`. O cabeçalho `request-id` do cliente é ignorado (`requestIdHeader: false`) para que
 * ninguém forje a correlação dos logs.
 *
 * `frameworkErrors` responde no envelope os erros que o roteador do Fastify trata antes do Nest
 * (URL malformada, parâmetro longo demais). Ele substitui o handler padrão do adaptador do Nest,
 * cuja única outra tarefa é rodar o hook de `app.useSecurityHeaders()`/`enableCsrfProtection()`,
 * que esta API não usa.
 */
export function criarAdaptadorFastify(logger: Logger): FastifyAdapter {
  const adaptador = new FastifyAdapter({
    loggerInstance: logger,
    logController: new LogController({ requestIdLogLabel: ROTULO_DO_REQUEST_ID }),
    requestIdHeader: false,
    genReqId: () => randomUUID(),
    frameworkErrors: responderErroDoRoteador,
  });
  // Cookies (specs/003 §Cookies, ADR 0027): lê `request.cookies` no onRequest e escreve os
  // Set-Cookie. Registrado antes de qualquer rota; o Fastify o carrega no ready().
  void adaptador.getInstance().register(fastifyCookie);
  return adaptador;
}

export function configurarApp(app: NestFastifyApplication): void {
  app.setGlobalPrefix(PREFIXO_DA_API);
  app.enableShutdownHooks();
}
