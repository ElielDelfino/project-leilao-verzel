import { http, HttpResponse, type HttpHandler } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll } from 'vitest';

import type { SchemasApi } from '@leilao/contracts';

export const ORIGEM = 'http://localhost:3000';

/** Sessão-base de todo teste: anônimo (nem `me` nem o refresh reconhecem credenciais). */
const handlersBase: HttpHandler[] = [
  handlerDeCsrf(),
  http.get(`${ORIGEM}/api/auth/me`, () => envelopeDeErro('NAO_AUTENTICADO', 401)),
  http.post(`${ORIGEM}/api/auth/refresh`, () => envelopeDeErro('SESSAO_EXPIRADA', 401)),
];

/** Servidor MSW compartilhado (test/setup.ts): requisição sem handler falha o teste. */
export const servidor = setupServer(...handlersBase);

export function usarServidorDeMocks(): void {
  beforeAll(() => servidor.listen({ onUnhandledFrame: 'error' }));
  afterEach(() => {
    servidor.resetHandlers();
    limparCookie('csrf_token');
  });
  afterAll(() => servidor.close());
}

export function lerCookie(nome: string): string | null {
  const par = document.cookie.split('; ').find((c) => c.startsWith(`${nome}=`));
  return par ? par.slice(nome.length + 1) : null;
}

export function definirCookie(nome: string, valor: string): void {
  document.cookie = `${nome}=${valor}; path=/`;
}

export function limparCookie(nome: string): void {
  document.cookie = `${nome}=; path=/; max-age=0`;
}

export function envelopeDeErro(
  codigo: SchemasApi['Erro']['erro']['codigo'],
  status: number,
  cabecalhos: Record<string, string> = {},
): Response {
  return HttpResponse.json(
    { sucesso: false, erro: { codigo, mensagem: 'texto interno da API' } },
    { status, headers: cabecalhos },
  );
}

/** GET /api/auth/csrf como a API faz: o Set-Cookie vira `document.cookie` no navegador. */
export function handlerDeCsrf(contador?: { chamadas: number }): HttpHandler {
  return http.get(`${ORIGEM}/api/auth/csrf`, () => {
    if (contador) contador.chamadas += 1;
    definirCookie('csrf_token', 'token-de-teste');
    return new HttpResponse(null, { status: 204 });
  });
}

export const usuarioLicitante = {
  id: '0192f3a0-0000-7000-8000-000000000001',
  nome: 'Ana Licitante',
  email: 'ana@exemplo.com',
  papel: 'licitante',
} satisfies SchemasApi['Usuario'];

export const usuarioLeiloeiro = {
  id: '0192f3a0-0000-7000-8000-000000000002',
  nome: 'Leo Leiloeiro',
  email: 'leo@exemplo.com',
  papel: 'leiloeiro',
} satisfies SchemasApi['Usuario'];

/** `GET /api/auth/me` para o usuário dado (ou anônimo, com `null`). */
export function handlerDeSessao(usuario: SchemasApi['Usuario'] | null): HttpHandler {
  return http.get(`${ORIGEM}/api/auth/me`, () =>
    usuario
      ? HttpResponse.json({ sucesso: true, dados: usuario })
      : envelopeDeErro('NAO_AUTENTICADO', 401),
  );
}
