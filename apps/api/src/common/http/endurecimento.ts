// Endurecimento HTTP da API de produção (tarefa 020), aplicado por criarApi (servidor.ts) antes do
// init do Nest: cabeçalhos de segurança (só fora de produção), origem nas rotas que mudam estado,
// x-request-id, bodyLimit e timeouts do servidor do Node.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyReply, FastifyRequest, HookHandlerDoneFunction } from 'fastify';

import { registrarCabecalhosDeSeguranca } from './cabecalhos-de-seguranca.js';
import { LIMITE_DO_CORPO_BYTES, TIMEOUTS_HTTP } from './limites-http.js';
import { criarVerificacaoDeOrigem } from './origem.js';

/** Tipos de corpo que a API aceita (os mesmos que o Nest registra por padrão no Fastify). */
const TIPOS_DE_CORPO = ['application/json', 'application/x-www-form-urlencoded'] as const;

export interface ConfigDoEndurecimento {
  /** Origem da SPA (env WEB_ORIGIN). */
  readonly WEB_ORIGIN: string;
  /** NODE_ENV=production: o Caddy põe os cabeçalhos de segurança e a API não os repete. */
  readonly producao?: boolean;
}

/**
 * Devolve ao cliente o id da requisição gerado pelo servidor (UUID; o cabeçalho do cliente é
 * ignorado por `requestIdHeader: false` em app.ts), para correlacionar um erro com os logs.
 */
function devolverIdDaRequisicao(
  requisicao: FastifyRequest,
  resposta: FastifyReply,
  continuar: HookHandlerDoneFunction,
): void {
  void resposta.header('x-request-id', requisicao.id);
  continuar();
}

export function endurecerHttp(app: NestFastifyApplication, config: ConfigDoEndurecimento): void {
  const servidor = app.getHttpServer();
  if (config.producao !== true) {
    registrarCabecalhosDeSeguranca(servidor);
  }
  // Mesmo efeito das opções keepAliveTimeout, requestTimeout e connectionTimeout do Fastify, que as
  // copia para este servidor ao criá-lo (lib/server.js); headersTimeout ≤ requestTimeout.
  servidor.keepAliveTimeout = TIMEOUTS_HTTP.keepAliveMs;
  servidor.requestTimeout = TIMEOUTS_HTTP.requisicaoMs;
  servidor.headersTimeout = TIMEOUTS_HTTP.cabecalhosMs;
  servidor.setTimeout(TIMEOUTS_HTTP.conexaoOciosaMs);

  // Parser explícito: o Nest não registra o padrão para um tipo que já tem parser próprio.
  for (const tipo of TIPOS_DE_CORPO) {
    app.useBodyParser(tipo, { bodyLimit: LIMITE_DO_CORPO_BYTES });
  }

  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook('onRequest', devolverIdDaRequisicao);
  fastify.addHook('onRequest', criarVerificacaoDeOrigem(config.WEB_ORIGIN));
}
