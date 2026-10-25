// Cookies de sessão (specs/003 §Cookies, ADR 0022 e 0027): atributos fixos da tabela; Secure
// quando WEB_ORIGIN começa com https://. Na expiração, valor vazio, Max-Age=0 e os mesmos atributos.
import type { FastifyReply } from 'fastify';

import { DURACAO_DO_ACCESS_TOKEN_S } from './tokens.js';

export const COOKIE_ACCESS = 'access_token';
export const COOKIE_REFRESH = 'refresh_token';
export const COOKIE_CSRF = 'csrf_token';

/** 7 dias (refresh_token e csrf_token). */
export const DURACAO_DA_SESSAO_S = 604_800;

interface AtributosDoCookie {
  readonly path: string;
  readonly httpOnly: boolean;
  readonly maxAge: number;
}

const ATRIBUTOS: Readonly<Record<string, AtributosDoCookie>> = {
  [COOKIE_ACCESS]: { path: '/', httpOnly: true, maxAge: DURACAO_DO_ACCESS_TOKEN_S },
  [COOKIE_REFRESH]: { path: '/api/auth', httpOnly: true, maxAge: DURACAO_DA_SESSAO_S },
  [COOKIE_CSRF]: { path: '/', httpOnly: false, maxAge: DURACAO_DA_SESSAO_S },
};

export interface TokensDaSessao {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly csrfToken: string;
}

function definir(
  resposta: FastifyReply,
  nome: string,
  valor: string,
  seguro: boolean,
  expirar = false,
): void {
  const atributos = ATRIBUTOS[nome];
  if (atributos === undefined) {
    throw new RangeError(`cookie desconhecido: ${nome}`);
  }
  resposta.setCookie(nome, valor, {
    path: atributos.path,
    httpOnly: atributos.httpOnly,
    sameSite: 'lax',
    secure: seguro,
    maxAge: expirar ? 0 : atributos.maxAge,
  });
}

export function emitirCookieCsrf(resposta: FastifyReply, token: string, seguro: boolean): void {
  definir(resposta, COOKIE_CSRF, token, seguro);
}

/** Cadastro, login e refresh: os três cookies (specs/003 §Cookies, coluna "Emitido por"). */
export function emitirCookiesDeSessao(
  resposta: FastifyReply,
  tokens: TokensDaSessao,
  seguro: boolean,
): void {
  definir(resposta, COOKIE_ACCESS, tokens.accessToken, seguro);
  definir(resposta, COOKIE_REFRESH, tokens.refreshToken, seguro);
  definir(resposta, COOKIE_CSRF, tokens.csrfToken, seguro);
}

/** Logout: os três cookies com valor vazio, Max-Age=0 e os mesmos Path da emissão. */
export function expirarCookies(resposta: FastifyReply, seguro: boolean): void {
  for (const nome of [COOKIE_ACCESS, COOKIE_REFRESH, COOKIE_CSRF]) {
    definir(resposta, nome, '', seguro, true);
  }
}
