import type { Type } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { DestinationStream } from 'pino';

import { AppModule } from '../../src/app.module.js';
import { configurarApp, criarAdaptadorFastify } from '../../src/app.js';
import { BANCO } from '../../src/config/banco.module.js';
import type { Env } from '../../src/config/env.js';
import type { Banco } from '../../src/db/banco.js';
import { lerConexaoDoBanco } from '../../src/db/conexao.js';
import {
  VERIFICACOES_DE_PRONTIDAO,
  type VerificacaoDeProntidao,
} from '../../src/health/prontidao.js';
import { criarLogger, LoggerNestPino } from '../../src/logger/logger.js';
import type { ClienteRedis } from '../../src/redis/cliente.js';
import { criarConexaoDoRedis } from '../../src/redis/conexao.js';
import { CLIENTE_REDIS } from '../../src/redis/redis.module.js';

/** Só forma canônica (specs/014 §Leitura); não abre nenhum serviço real. */
const SENHA_FALSA = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

/**
 * Env de teste sem infraestrutura: as conexões apontam para a porta 1 do loopback. Os testes que
 * usam este env com `clientesReais` recebem ECONNREFUSED (Postgres e Redis "fora").
 */
export const ENV_DE_TESTE: Env = {
  API_PORT: 13000,
  LOG_LEVEL: 'silent',
  postgres: lerConexaoDoBanco({
    POSTGRES_HOST: '127.0.0.1',
    POSTGRES_PORT: '1',
    POSTGRES_DB: 'leilao_inexistente',
    POSTGRES_USER: 'leilao',
    DB_PASSWORD: SENHA_FALSA,
  }),
  redis: criarConexaoDoRedis({ host: '127.0.0.1', port: 1 }, SENHA_FALSA),
};

const SEM_INFRA =
  'cliente falso do app de teste: use clientesReais para falar com a infraestrutura';

/** Banco falso: toda consulta rejeita; `encerrar` é observável. */
export function bancoFalso(): Banco & { readonly encerrado: () => boolean } {
  let encerrado = false;
  return {
    consultar: () => Promise.reject(new Error(SEM_INFRA)),
    transaction: () => Promise.reject(new Error(SEM_INFRA)),
    encerrar: () => {
      encerrado = true;
      return Promise.resolve();
    },
    encerrado: () => encerrado,
  };
}

/** Redis falso: o PING rejeita; `encerrar` é observável. */
export function redisFalso(): ClienteRedis & { readonly encerrado: () => boolean } {
  let encerrado = false;
  return {
    ping: () => Promise.reject(new Error(SEM_INFRA)),
    encerrar: () => {
      encerrado = true;
      return Promise.resolve();
    },
    encerrado: () => encerrado,
  };
}

export interface OpcoesDoAppDeTeste {
  /** Env usado no lugar de ENV_DE_TESTE (o LOG_LEVEL ainda segue `destinoDosLogs`). */
  readonly env?: Env;
  /** Substitui as verificações de prontidão registradas no HealthModule. */
  readonly verificacoes?: readonly VerificacaoDeProntidao[];
  /**
   * Usa o pool do Postgres e o cliente Redis reais, com as conexões do `env`. Sem isso, entram
   * `banco` e `redis` (por padrão, os falsos acima) e nenhum teste de unidade abre conexão.
   */
  readonly clientesReais?: boolean;
  readonly banco?: Banco;
  readonly redis?: ClienteRedis;
  /** Módulos só de teste (por exemplo, rotas que lançam erros). */
  readonly modulosExtras?: readonly Type[];
  /** Captura os logs JSON; quando presente, o nível passa a ser "info". */
  readonly destinoDosLogs?: DestinationStream;
}

/** Monta a API com o mesmo adaptador, logger, prefixo e filtro global do main.ts. */
export async function criarAppDeTeste(
  opcoes: OpcoesDoAppDeTeste = {},
): Promise<NestFastifyApplication> {
  const base = opcoes.env ?? ENV_DE_TESTE;
  const env: Env = opcoes.destinoDosLogs ? { ...base, LOG_LEVEL: 'info' } : base;
  const logger = criarLogger(env.LOG_LEVEL, opcoes.destinoDosLogs);

  let construtor = Test.createTestingModule({
    imports: [AppModule.registrar(env), ...(opcoes.modulosExtras ?? [])],
  });
  if (!opcoes.clientesReais) {
    construtor = construtor
      .overrideProvider(BANCO)
      .useValue(opcoes.banco ?? bancoFalso())
      .overrideProvider(CLIENTE_REDIS)
      .useValue(opcoes.redis ?? redisFalso());
  }
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
