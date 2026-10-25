// Ambiente dos testes de integração do módulo identidade: app com Postgres e Redis reais, chaves
// geradas no teste e um prefixo de rate limit próprio (apagado com SCAN + DEL, specs/013).
import { randomBytes, randomUUID } from 'node:crypto';

import type { Type } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { LightMyRequestResponse } from 'fastify';

import { criarSegredosDaApi, type Env } from '../../../src/config/env.js';
import { ambienteDeTeste } from '../../db/ambiente-de-teste.js';
import { criarAppDeTeste, ENV_DE_TESTE } from '../../helpers/app-de-teste.js';
import { capturarLogs, type LinhaDeLog } from '../../helpers/captura-de-logs.js';
import { ambienteDoRedis } from '../../redis/ambiente-de-teste.js';
import { apagarChavesDoPrefixo, clienteDeTeste } from '../../common/limite/redis-de-teste.js';

export const BANCO = ambienteDeTeste(process.env);
export const REDIS = ambienteDoRedis(process.env);
export const INFRA_DISPONIVEL = BANCO.disponivel && REDIS.disponivel;

export const CHAVE_JWT = new Uint8Array(randomBytes(32));

/** Env com Postgres (credenciais do dono nos nomes da API, specs/013) e Redis reais. */
export function envReal(webOrigin = 'http://localhost:15173'): Env {
  return {
    ...ENV_DE_TESTE,
    postgres: BANCO.conexao(),
    redis: REDIS.conexao(),
    WEB_ORIGIN: webOrigin,
    cookiesSeguros: webOrigin.startsWith('https://'),
    segredos: criarSegredosDaApi({
      chaveJwt: CHAVE_JWT,
      chavePseudonimo: new Uint8Array(randomBytes(32)),
      sementeEd25519: new Uint8Array(randomBytes(32)),
    }),
  };
}

export interface AppDeIdentidade {
  readonly app: NestFastifyApplication;
  readonly linhas: LinhaDeLog[];
  /** Apaga as chaves de rate limit deste app (só o prefixo dele). */
  resetarLimite(): Promise<void>;
  fechar(): Promise<void>;
}

export async function criarAppDeIdentidade(
  opcoes: { webOrigin?: string; modulosExtras?: readonly Type[] } = {},
): Promise<AppDeIdentidade> {
  const prefixo = `ratelimit:teste-${randomUUID()}:`;
  const { destino, linhas } = capturarLogs();
  const app = await criarAppDeTeste({
    env: envReal(opcoes.webOrigin),
    clientesReais: true,
    prefixoDoLimite: prefixo,
    destinoDosLogs: destino,
    ...(opcoes.modulosExtras ? { modulosExtras: opcoes.modulosExtras } : {}),
  });
  const redis = await clienteDeTeste(REDIS.conexao());
  return {
    app,
    linhas,
    resetarLimite: () => apagarChavesDoPrefixo(redis, prefixo),
    fechar: async () => {
      await apagarChavesDoPrefixo(redis, prefixo);
      redis.destroy();
      await app.close();
    },
  };
}

/** Cookies recebidos, como o navegador os guardaria (nome → valor), mais o `csrf_token`. */
export class Navegador {
  readonly #app: NestFastifyApplication;
  readonly #ip: string;
  readonly cookies = new Map<string, string>();

  constructor(app: NestFastifyApplication, ip = '127.0.0.1') {
    this.#app = app;
    this.#ip = ip;
  }

  guardar(resposta: LightMyRequestResponse): LightMyRequestResponse {
    for (const cookie of resposta.cookies) {
      if (cookie.maxAge === 0) {
        this.cookies.delete(cookie.name);
      } else {
        this.cookies.set(cookie.name, cookie.value);
      }
    }
    return resposta;
  }

  cabecalhoCookie(): string {
    return [...this.cookies].map(([nome, valor]) => `${nome}=${valor}`).join('; ');
  }

  async obterCsrf(): Promise<void> {
    this.guardar(await this.get('/api/auth/csrf'));
  }

  async get(url: string): Promise<LightMyRequestResponse> {
    return this.guardar(
      await this.#app.inject({
        method: 'GET',
        url,
        remoteAddress: this.#ip,
        headers: { cookie: this.cabecalhoCookie() },
      }),
    );
  }

  /** POST com o X-CSRF-Token igual ao cookie (double-submit), salvo `semCsrf`. */
  async post(
    url: string,
    corpo?: unknown,
    opcoes: { semCsrf?: boolean; csrf?: string } = {},
  ): Promise<LightMyRequestResponse> {
    const csrf = opcoes.csrf ?? this.cookies.get('csrf_token');
    const headers: Record<string, string> = { cookie: this.cabecalhoCookie() };
    if (!opcoes.semCsrf && csrf !== undefined) {
      headers['x-csrf-token'] = csrf;
    }
    return this.guardar(
      await this.#app.inject({
        method: 'POST',
        url,
        remoteAddress: this.#ip,
        headers,
        ...(corpo === undefined ? {} : { payload: corpo as object }),
      }),
    );
  }
}

export function emailNovo(): string {
  return `conta-${randomUUID()}@teste.local`;
}

export const SENHA = 'senha-de-teste-123';

export async function cadastrar(
  navegador: Navegador,
  dados: { email?: string; papel?: 'leiloeiro' | 'licitante'; senha?: string } = {},
): Promise<{ email: string; resposta: LightMyRequestResponse }> {
  const email = dados.email ?? emailNovo();
  if (!navegador.cookies.has('csrf_token')) {
    await navegador.obterCsrf();
  }
  const resposta = await navegador.post('/api/auth/cadastro', {
    nome: 'Conta de Teste',
    email,
    senha: dados.senha ?? SENHA,
    papel: dados.papel ?? 'licitante',
  });
  return { email, resposta };
}
