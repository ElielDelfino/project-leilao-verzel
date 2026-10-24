import type { Type } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { DestinationStream } from 'pino';

import { AppModule } from '../../src/app.module.js';
import { configurarApp, criarAdaptadorFastify } from '../../src/app.js';
import type { Env } from '../../src/config/env.js';
import {
  VERIFICACOES_DE_PRONTIDAO,
  type VerificacaoDeProntidao,
} from '../../src/health/prontidao.js';
import { criarLogger, LoggerNestPino } from '../../src/logger/logger.js';

export const ENV_DE_TESTE: Env = { API_PORT: 13000, LOG_LEVEL: 'silent' };

export interface OpcoesDoAppDeTeste {
  /** Substitui as verificações de prontidão registradas no HealthModule. */
  readonly verificacoes?: readonly VerificacaoDeProntidao[];
  /** Módulos só de teste (por exemplo, rotas que lançam erros). */
  readonly modulosExtras?: readonly Type[];
  /** Captura os logs JSON; quando presente, o nível passa a ser "info". */
  readonly destinoDosLogs?: DestinationStream;
}

/** Monta a API com o mesmo adaptador, logger, prefixo e filtro global do main.ts. */
export async function criarAppDeTeste(
  opcoes: OpcoesDoAppDeTeste = {},
): Promise<NestFastifyApplication> {
  const env: Env = opcoes.destinoDosLogs ? { ...ENV_DE_TESTE, LOG_LEVEL: 'info' } : ENV_DE_TESTE;
  const logger = criarLogger(env.LOG_LEVEL, opcoes.destinoDosLogs);

  let construtor = Test.createTestingModule({
    imports: [AppModule.registrar(env), ...(opcoes.modulosExtras ?? [])],
  });
  if (opcoes.verificacoes) {
    construtor = construtor
      .overrideProvider(VERIFICACOES_DE_PRONTIDAO)
      .useValue(opcoes.verificacoes);
  }
  const moduloDeTeste = await construtor.compile();

  const app = moduloDeTeste.createNestApplication<NestFastifyApplication>(
    criarAdaptadorFastify(logger),
    { logger: new LoggerNestPino(logger) },
  );
  configurarApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}
