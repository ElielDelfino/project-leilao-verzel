import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { configurarApp, criarAdaptadorFastify } from './app.js';
import { AppModule } from './app.module.js';
import { carregarEnv, ErroDeConfiguracao } from './config/env.js';
import { criarLogger, LoggerNestPino } from './logger/logger.js';

// Em contêiner a API precisa escutar em todas as interfaces; em produção só o Caddy a alcança
// (specs/014: portas internas).
const HOST = '0.0.0.0';

async function iniciar(): Promise<void> {
  const env = carregarEnv(process.env);
  const logger = criarLogger(env.LOG_LEVEL);

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.registrar(env),
    criarAdaptadorFastify(logger),
    { logger: new LoggerNestPino(logger) },
  );
  configurarApp(app);
  await app.listen(env.API_PORT, HOST);
}

iniciar().catch((erro: unknown) => {
  // O logger ainda pode não existir (env inválido): escreve uma linha JSON direto no stderr.
  // ErroDeConfiguracao só cita nomes de variáveis, nunca valores.
  const mensagem = erro instanceof ErroDeConfiguracao ? erro.message : 'falha ao iniciar a API';
  const linha = { level: 60, time: new Date().toISOString(), msg: mensagem };
  const detalhe =
    erro instanceof ErroDeConfiguracao || !(erro instanceof Error)
      ? linha
      : { ...linha, err: { type: erro.name, message: erro.message, stack: erro.stack } };
  process.stderr.write(`${JSON.stringify(detalhe)}\n`);
  process.exit(1);
});
