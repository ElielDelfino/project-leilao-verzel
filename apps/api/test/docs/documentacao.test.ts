// Documentação navegável (specs/001 §Contratos, ADR 0036, tarefa 144): GET /api/docs (Swagger UI
// self-hosted) e GET /api/docs/json (o openapi.yaml convertido para JSON). As rotas não são
// operações do contrato: o validador de specs/013 não as cobre e este teste confere status,
// content-type, cabeçalhos e a igualdade com o YAML lido.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { CAMINHO_DO_CONTRATO } from '../../src/docs/index.js';
import { criarAppDeTeste } from '../helpers/app-de-teste.js';

const RAIZ_DA_API = fileURLToPath(new URL('../../', import.meta.url));
const PASTA_DO_SWAGGER_UI = dirname(
  createRequire(import.meta.url).resolve('swagger-ui-dist/package.json'),
);

let app: NestFastifyApplication;

beforeAll(async () => {
  app = await criarAppDeTeste();
});

afterAll(async () => {
  await app.close();
});

/** Atributo `nome` de cada tag `<tag ...>` do HTML. */
function atributos(html: string, tag: string, nome: string): string[] {
  const tags = html.match(new RegExp(`<${tag}\\b[^>]*>`, 'gi')) ?? [];
  return tags.map((t) => new RegExp(`\\b${nome}="([^"]*)"`, 'i').exec(t)?.[1] ?? '');
}

/** Objeto `config` que o swagger-initializer.js passa ao SwaggerUIBundle (o nosso `uiConfig`). */
function configDoInicializador(js: string): Record<string, unknown> {
  const literal = /const config = (\{.*\})\n/.exec(js)?.[1];
  expect(literal).toBeDefined();
  return JSON.parse(literal ?? '{}') as Record<string, unknown>;
}

describe('GET /api/docs (Swagger UI, ADR 0036)', () => {
  it('responde 200 text/html com Cache-Control no-cache, fora do envelope', async () => {
    const resposta = await app.inject({ method: 'GET', url: '/api/docs' });

    expect(resposta.statusCode).toBe(200);
    expect(resposta.headers['content-type']).toMatch(/^text\/html/);
    expect(resposta.headers['cache-control']).toBe('no-cache');
    expect(resposta.body).toContain('<div id="swagger-ui">');
  });

  it('só carrega script e estilo de arquivos da própria origem, sem <script> inline', async () => {
    const html = (await app.inject({ method: 'GET', url: '/api/docs' })).body;

    const scripts = atributos(html, 'script', 'src');
    expect(scripts.length).toBeGreaterThan(0);
    for (const src of scripts) {
      expect(src).toMatch(/^\/api\/docs\/static\/[\w.-]+\.js$/);
    }
    // Todo <script> tem src e corpo vazio (só espaço): nada inline.
    for (const [, corpo] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script[^>]*>/gi)) {
      expect(corpo?.trim()).toBe('');
    }
    expect(html).not.toMatch(/<style\b/i);
    expect(html).not.toMatch(/\sstyle=/i);
    expect(html).not.toMatch(/\son[a-z]+=/i);
    for (const href of atributos(html, 'link', 'href')) {
      expect(href).toMatch(/^\/api\/docs\/static\/[\w.-]+$/);
    }
  });

  it('não gera Content-Security-Policy na API (a CSP vem só do Caddy)', async () => {
    const resposta = await app.inject({ method: 'GET', url: '/api/docs' });

    expect(resposta.headers['content-security-policy']).toBeUndefined();
  });

  it('serve os assets do swagger-ui-dist fixado no lockfile', async () => {
    for (const arquivo of ['swagger-ui-bundle.js', 'swagger-ui.css']) {
      const resposta = await app.inject({ method: 'GET', url: `/api/docs/static/${arquivo}` });

      expect(resposta.statusCode).toBe(200);
      expect(resposta.rawPayload.equals(readFileSync(join(PASTA_DO_SWAGGER_UI, arquivo)))).toBe(
        true,
      );
    }
  });

  it('configura o Swagger UI num arquivo .js: sem validador externo, ?url=, deep link nem auth persistida', async () => {
    const resposta = await app.inject({
      method: 'GET',
      url: '/api/docs/static/swagger-initializer.js',
    });

    expect(resposta.statusCode).toBe(200);
    expect(resposta.headers['content-type']).toMatch(/^application\/javascript/);
    expect(configDoInicializador(resposta.body)).toEqual({
      validatorUrl: null,
      queryConfigEnabled: false,
      persistAuthorization: false,
      deepLinking: false,
      layout: 'BaseLayout',
    });
    expect(resposta.body).not.toContain('petstore');
  });

  // Tarefa 147: o StandaloneLayout (padrão do plugin) desenha o topbar, cujo logo SVG traz um
  // <style> inline que a CSP do Caddy (style-src 'self') bloqueia. O BaseLayout não tem topbar.
  it('usa o BaseLayout, sem o topbar cujo logo injeta <style> inline bloqueado pela CSP', async () => {
    const resposta = await app.inject({
      method: 'GET',
      url: '/api/docs/static/swagger-initializer.js',
    });

    expect(configDoInicializador(resposta.body)['layout']).toBe('BaseLayout');
  });
});

describe('GET /api/docs/json (contrato, ADR 0036)', () => {
  it('responde o openapi.yaml em JSON, com Cache-Control no-cache e fora do envelope', async () => {
    const resposta = await app.inject({ method: 'GET', url: '/api/docs/json' });

    expect(resposta.statusCode).toBe(200);
    expect(resposta.headers['content-type']).toMatch(/^application\/json/);
    expect(resposta.headers['cache-control']).toBe('no-cache');
    const corpo = resposta.json<Record<string, unknown>>();
    expect(corpo).not.toHaveProperty('sucesso');
    expect(corpo['openapi']).toBe('3.1.0');
    expect(corpo['servers']).toEqual([expect.objectContaining({ url: '/' })]);
    expect(corpo).toEqual(parse(readFileSync(join(RAIZ_DA_API, 'openapi.yaml'), 'utf8')));
  });

  it('lê o contrato de apps/api/openapi.yaml (em produção, /app/apps/api/openapi.yaml)', () => {
    expect(CAMINHO_DO_CONTRATO).toBe(resolve(RAIZ_DA_API, 'openapi.yaml'));
  });
});

describe('rotas extras do plugin ficam fechadas', () => {
  it.each(['/api/docs/yaml', '/api/docs/package.json', '/api/docs/index.html'])(
    'GET %s responde como rota inexistente (404 NAO_ENCONTRADO)',
    async (url) => {
      const resposta = await app.inject({ method: 'GET', url });
      const inexistente = await app.inject({ method: 'GET', url: '/api/rota-que-nao-existe' });

      expect(resposta.statusCode).toBe(404);
      expect(resposta.json()).toEqual(inexistente.json());
      expect(resposta.json()).toMatchObject({
        sucesso: false,
        erro: { codigo: 'NAO_ENCONTRADO' },
      });
    },
  );
});
