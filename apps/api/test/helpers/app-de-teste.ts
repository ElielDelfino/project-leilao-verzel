import type { Type } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { LightMyRequestResponse } from 'fastify';
import type { DestinationStream } from 'pino';

import { AppModule } from '../../src/app.module.js';
import { configurarApp, criarAdaptadorFastify } from '../../src/app.js';
import type { ContadorDeJanela } from '../../src/common/limite/limite-de-tentativas.js';
import { CONTADOR_DE_JANELA, PREFIXO_DO_LIMITE } from '../../src/common/limite/limite.module.js';
import { BANCO } from '../../src/config/banco.module.js';
import { criarSegredosDaApi, type Env } from '../../src/config/env.js';
import type { BancoVerificavel } from '../../src/db/banco.js';
import { lerConexaoDoBanco, VARIAVEIS_DA_API } from '../../src/db/conexao.js';
import {
  VERIFICACOES_DE_PRONTIDAO,
  type VerificacaoDeProntidao,
} from '../../src/health/prontidao.js';
import { criarLogger, LoggerNestPino } from '../../src/logger/logger.js';
import type { ClienteRedis, ClienteRedisComCatalogo } from '../../src/redis/cliente.js';
import { criarConexaoDoRedis } from '../../src/redis/conexao.js';
import { CLIENTE_REDIS } from '../../src/redis/redis.module.js';
import { caminhoDoContrato, validarContrato } from './contrato.js';

/** Só forma canônica (specs/014 §Leitura); não abre nenhum serviço real. */
const SENHA_FALSA = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

/** 32 bytes fixos para as chaves do env de teste (não são segredos de nenhum ambiente). */
const CHAVE_FALSA = new Uint8Array(32).fill(7);

/**
 * Env de teste sem infraestrutura: as conexões apontam para a porta 1 do loopback. Os testes que
 * usam este env com `clientesReais` recebem ECONNREFUSED (Postgres e Redis "fora"). O Postgres usa
 * os nomes de variáveis da API (POSTGRES_API_USER/DB_API_PASSWORD); os testes de integração passam
 * nelas as credenciais do dono (specs/013 §Papéis do Postgres nos testes, D3).
 */
export const ENV_DE_TESTE: Env = {
  API_PORT: 13000,
  LOG_LEVEL: 'silent',
  postgres: lerConexaoDoBanco(
    {
      POSTGRES_HOST: '127.0.0.1',
      POSTGRES_PORT: '1',
      POSTGRES_DB: 'leilao_inexistente',
      POSTGRES_API_USER: 'leilao',
      DB_API_PASSWORD: SENHA_FALSA,
    },
    VARIAVEIS_DA_API,
  ),
  redis: criarConexaoDoRedis({ host: '127.0.0.1', port: 1 }, SENHA_FALSA),
  WEB_ORIGIN: 'http://localhost:15173',
  cookiesSeguros: false,
  segredos: criarSegredosDaApi({
    chaveJwt: CHAVE_FALSA,
    chavePseudonimo: CHAVE_FALSA,
    sementeEd25519: CHAVE_FALSA,
  }),
  // Porta 1 do loopback: nenhum teste sem Scryfall falsa chega a uma Scryfall de verdade.
  scryfall: { userAgent: 'LeilaoVerzel/teste', baseUrl: 'http://127.0.0.1:1' },
};

const SEM_INFRA =
  'cliente falso do app de teste: use clientesReais para falar com a infraestrutura';

/** Banco falso: toda consulta e a verificação rejeitam; `encerrar` é observável. */
export function bancoFalso(): BancoVerificavel & { readonly encerrado: () => boolean } {
  let encerrado = false;
  return {
    consultar: () => Promise.reject(new Error(SEM_INFRA)),
    transaction: () => Promise.reject(new Error(SEM_INFRA)),
    verificar: () => Promise.reject(new Error(SEM_INFRA)),
    encerrar: () => {
      encerrado = true;
      return Promise.resolve();
    },
    encerrado: () => encerrado,
  };
}

/** Redis falso: todo comando rejeita (como o Redis fora); `encerrar` é observável. */
export function redisFalso(): ClienteRedisComCatalogo & { readonly encerrado: () => boolean } {
  let encerrado = false;
  const rejeitar = (): Promise<never> => Promise.reject(new Error(SEM_INFRA));
  return {
    ping: rejeitar,
    aguardarConexao: () => Promise.resolve(),
    incrementarNaJanela: rejeitar,
    obter: rejeitar,
    gravarComTtl: rejeitar,
    ttlRestanteMs: rejeitar,
    executarLua: rejeitar,
    encerrar: () => {
      encerrado = true;
      return Promise.resolve();
    },
    encerrado: () => encerrado,
  };
}

/** Contador do rate limit falso: toda contagem rejeita (como o Redis fora). */
export function contadorFalso(): ContadorDeJanela {
  return { incrementar: () => Promise.reject(new Error(SEM_INFRA)) };
}

export interface OpcoesDoAppDeTeste {
  /** Env usado no lugar de ENV_DE_TESTE (o LOG_LEVEL ainda segue `destinoDosLogs`). */
  readonly env?: Env;
  /** Substitui as verificações de prontidão registradas no HealthModule. */
  readonly verificacoes?: readonly VerificacaoDeProntidao[];
  /**
   * Usa o pool do Postgres e os clientes Redis reais, com as conexões do `env`. Sem isso, entram
   * `banco`, `redis` e `contador` (por padrão, os falsos acima) e nenhum teste abre conexão.
   */
  readonly clientesReais?: boolean;
  readonly banco?: BancoVerificavel;
  readonly redis?: ClienteRedis;
  readonly contador?: ContadorDeJanela;
  /** Prefixo próprio das chaves de rate limit (sob `ratelimit:`; specs/013). */
  readonly prefixoDoLimite?: string;
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
      .useValue(opcoes.redis ?? redisFalso())
      .overrideProvider(CONTADOR_DE_JANELA)
      .useValue(opcoes.contador ?? contadorFalso());
  }
  if (opcoes.prefixoDoLimite !== undefined) {
    construtor = construtor.overrideProvider(PREFIXO_DO_LIMITE).useValue(opcoes.prefixoDoLimite);
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
  return validarCadaResposta(app);
}

type OpcoesDeInject = { method?: string; url?: string; path?: string } | string;

/**
 * Todo `inject` com opções passa a validar a resposta contra o openapi.yaml (specs/013 §Contratos):
 * os testes de integração viram também testes de contrato. Rotas que o contrato não declara
 * (módulos só de teste, 404 de rota inexistente) ficam de fora.
 */
function validarCadaResposta(app: NestFastifyApplication): NestFastifyApplication {
  const original = app.inject.bind(app) as (...args: unknown[]) => unknown;
  const comValidacao = (...args: unknown[]): unknown => {
    const resultado = original(...args);
    const opcoes = args[0] as OpcoesDeInject | undefined;
    if (opcoes === undefined || typeof (resultado as PromiseLike<unknown>)?.then !== 'function') {
      return resultado;
    }
    return Promise.resolve(resultado).then((resposta) => {
      conferirContrato(opcoes, resposta as LightMyRequestResponse);
      return resposta;
    });
  };
  app.inject = comValidacao as typeof app.inject;
  return app;
}

function conferirContrato(opcoes: OpcoesDeInject, resposta: LightMyRequestResponse): void {
  const url = typeof opcoes === 'string' ? opcoes : (opcoes.url ?? opcoes.path ?? '');
  const metodo = typeof opcoes === 'string' ? 'GET' : (opcoes.method ?? 'GET');
  const caminho = caminhoDoContrato(url);
  if (caminho === undefined) return;
  const headers: Record<string, string> = {};
  for (const [nome, valor] of Object.entries(resposta.headers)) {
    headers[nome] = Array.isArray(valor) ? valor.join(', ') : String(valor);
  }
  const ehJson = (headers['content-type'] ?? '').includes('application/json');
  validarContrato({
    metodo,
    caminho,
    status: resposta.statusCode,
    headers,
    corpo: ehJson ? resposta.json() : resposta.body === '' ? undefined : resposta.body,
  });
}
