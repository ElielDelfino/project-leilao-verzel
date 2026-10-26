// Construção da API de produção, separada do main.ts para ser testável.
import { NestFactory } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { DestinationStream } from 'pino';

import { configurarApp, criarAdaptadorFastify } from './app.js';
import { AppModule } from './app.module.js';
import { endurecerHttp } from './common/http/index.js';
import { type Env, ErroDeConfiguracao } from './config/env.js';
import { criarLogger, LoggerNestPino } from './logger/logger.js';

/**
 * Cria a API com o adaptador Fastify, o logger Pino (também usado pelo Nest), o prefixo /api e o
 * endurecimento HTTP (tarefa 020: cabeçalhos só fora de produção, origem, x-request-id, bodyLimit
 * e timeouts).
 */
export async function criarApi(
  env: Env,
  destinoDosLogs?: DestinationStream,
): Promise<NestFastifyApplication> {
  const logger = criarLogger(env.LOG_LEVEL, destinoDosLogs);
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.registrar(env),
    criarAdaptadorFastify(logger),
    { logger: new LoggerNestPino(logger) },
  );
  configurarApp(app);
  endurecerHttp(app, env);
  return app;
}

const NIVEL_FATAL = 60;
const MENSAGEM_GENERICA = 'falha ao iniciar a API';

/**
 * Linha JSON (no formato do Pino) para uma falha antes de o logger existir. ErroDeConfiguracao
 * só cita nomes de variáveis; outro Error leva a causa para o operador; qualquer outro valor
 * lançado não é serializado, porque pode conter segredos.
 */
export function descreverFalhaNoBoot(erro: unknown, agora: Date = new Date()): string {
  const base = { level: NIVEL_FATAL, time: agora.toISOString() };
  if (erro instanceof ErroDeConfiguracao) {
    return `${JSON.stringify({ ...base, msg: erro.message })}\n`;
  }
  if (erro instanceof Error) {
    const err = { type: erro.name, message: erro.message, stack: erro.stack };
    return `${JSON.stringify({ ...base, msg: MENSAGEM_GENERICA, err })}\n`;
  }
  return `${JSON.stringify({ ...base, msg: MENSAGEM_GENERICA })}\n`;
}
