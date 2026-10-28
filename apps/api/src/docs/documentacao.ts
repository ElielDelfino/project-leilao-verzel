// Documentação navegável do contrato (specs/001 §Contratos, ADR 0036): GET /api/docs (Swagger UI
// self-hosted) e GET /api/docs/json (o openapi.yaml em JSON). Plugins do Fastify registrados direto
// na instância, fora do Nest: as rotas não passam por guard, interceptor nem envelope de sucesso,
// e não são operações do openapi.yaml.
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi, { type FastifySwaggerUiConfigOptions } from '@fastify/swagger-ui';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/**
 * Contrato REST lido pela documentação. De src/docs/ ou dist/docs/ fica 2 níveis acima: no
 * repositório, apps/api/openapi.yaml; na imagem (WORKDIR /app/apps/api), /app/apps/api/openapi.yaml.
 */
export const CAMINHO_DO_CONTRATO = fileURLToPath(new URL('../../openapi.yaml', import.meta.url));

/** Assets do Swagger UI: o swagger-ui-dist da versão exata do lockfile (ADR 0036, item 5). */
const PASTA_DO_SWAGGER_UI = dirname(
  createRequire(import.meta.url).resolve('swagger-ui-dist/package.json'),
);

/** Sob o prefixo global /api (PREFIXO_DA_API em app.ts), as rotas ficam em /api/docs. */
const PREFIXO_DA_DOCUMENTACAO = '/docs';

/**
 * Configuração do Swagger UI (ADR 0036, item 3). Vai para o swagger-initializer.js servido pela API,
 * nunca inline. O `url` é fixado pelo plugin como ./json relativo à página, isto é, /api/docs/json.
 * `queryConfigEnabled` é opção do Swagger UI (padrão false no bundle) que os tipos do plugin não
 * declaram; fica explícito para a página ignorar `?url=` e `?configUrl=`.
 * `layout: 'BaseLayout'` (o padrão do Swagger UI) substitui o `StandaloneLayout` que o plugin põe por
 * padrão: o topbar deste último desenha um logo SVG com `<style>` inline, que a CSP do Caddy
 * (`style-src 'self'`) bloqueia (tarefa 147). Sem topbar, some também a caixa "Explore", que
 * carregaria outra URL.
 */
const CONFIG_DO_SWAGGER_UI: FastifySwaggerUiConfigOptions & { readonly queryConfigEnabled: false } =
  {
    validatorUrl: null,
    queryConfigEnabled: false,
    persistAuthorization: false,
    deepLinking: false,
    layout: 'BaseLayout',
  };

/**
 * Rotas do @fastify/swagger-ui que a spec não prevê e que o plugin não permite desligar:
 * `{prefixo}/yaml` (o contrato em YAML) e, com `baseDir`, `{prefixo}/*` (qualquer arquivo da pasta
 * do swagger-ui-dist, como o index.html de exemplo). Respondem como rota inexistente.
 */
const ROTAS_FORA_DA_SPEC = ['yaml', '*'] as const;

/**
 * Hook das rotas do plugin (página, JSON e swagger-initializer.js; os arquivos estáticos não passam
 * por ele): fecha as rotas fora da spec e marca as demais com `Cache-Control: no-cache`.
 */
function criarHookDaDocumentacao(
  prefixoCompleto: string,
): (requisicao: FastifyRequest, resposta: FastifyReply) => Promise<void> {
  const fechadas = new Set(ROTAS_FORA_DA_SPEC.map((rota) => `${prefixoCompleto}/${rota}`));
  return async (requisicao, resposta) => {
    if (fechadas.has(requisicao.routeOptions.url ?? '')) {
      await resposta.callNotFound();
      return;
    }
    void resposta.header('cache-control', 'no-cache');
  };
}

async function documentacao(escopo: FastifyInstance): Promise<void> {
  await escopo.register(fastifySwagger, {
    mode: 'static',
    specification: { path: CAMINHO_DO_CONTRATO, baseDir: dirname(CAMINHO_DO_CONTRATO) },
  });
  await escopo.register(fastifySwaggerUi, {
    routePrefix: PREFIXO_DA_DOCUMENTACAO,
    // O plugin monta os links da página sem o prefixo do escopo; indexPrefix os põe sob /api.
    indexPrefix: escopo.prefix,
    baseDir: PASTA_DO_SWAGGER_UI,
    // Sem staticCSP: a CSP vem só do Caddy, igual à de / (ADR 0036, item 4).
    staticCSP: false,
    uiConfig: CONFIG_DO_SWAGGER_UI,
    uiHooks: { onRequest: criarHookDaDocumentacao(`${escopo.prefix}${PREFIXO_DA_DOCUMENTACAO}`) },
  });
}

/** Registra /api/docs e /api/docs/json na instância do Fastify (antes do ready). */
export function registrarDocumentacao(fastify: FastifyInstance, prefixoDaApi: string): void {
  void fastify.register(documentacao, { prefix: `/${prefixoDaApi}` });
}
