// e2e da documentação da API (task 146, ADR 0036, specs/014 §Produção "Documentação da API"): o
// Swagger UI em /api/docs lista as operações do contrato e o "Try it out" de GET /api/health/live
// devolve 200, sem nenhuma violação de CSP no console.
//
// CSP: no e2e a página passa pelo proxy /api do Vite (mesma origem, como o handle /api/* do Caddy),
// e nem o Vite nem a API emitem CSP. Sem CSP a checagem passaria sempre. Por isso o teste aplica na
// resposta de /api/docs a mesma CSP do infra/caddy/Caddyfile versionado, lida do arquivo a cada
// execução: se a CSP de produção mudar, o teste passa a valer contra a nova.
import { readFileSync } from 'node:fs';

import { expect, test, type Page } from '@playwright/test';
import { parse } from 'yaml';

import { violacoesBloqueantes } from './apoio/axe.js';
import { limparRateLimit } from './apoio/rate-limit.js';

const CADDYFILE = new URL('../infra/caddy/Caddyfile', import.meta.url);
const CONTRATO = new URL('../apps/api/openapi.yaml', import.meta.url);
const ROTA_DA_DOCUMENTACAO = '/api/docs';
const ROTA_DO_HEALTH_LIVE = '/api/health/live';
const METODOS_HTTP = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);
/** Texto que o Chromium registra no console ao bloquear algo pela CSP. */
const VIOLACAO_DE_CSP = /Content Security Policy/i;

/** A CSP do bloco `header` do Caddyfile de produção (ADR 0024 item 4, ADR 0029). */
function cspDoCaddyfile(): string {
  const texto = readFileSync(CADDYFILE, 'utf8');
  const achados = [...texto.matchAll(/^\s*Content-Security-Policy\s+"([^"]+)"\s*$/gm)];
  const csp = achados[0]?.[1];
  if (achados.length !== 1 || csp === undefined) {
    throw new Error('e2e: esperava exatamente um Content-Security-Policy no Caddyfile');
  }
  return csp;
}

interface Operacao {
  readonly tags: readonly string[];
}

interface Contrato {
  readonly tags: readonly { readonly name: string }[];
  readonly paths: Readonly<Record<string, Readonly<Record<string, Operacao>>>>;
}

function lerContrato(): Contrato {
  return parse(readFileSync(CONTRATO, 'utf8')) as Contrato;
}

/** Quantos blocos de operação o Swagger UI mostra: uma operação aparece uma vez por tag. */
function blocosDeOperacaoEsperados(contrato: Contrato): number {
  return Object.values(contrato.paths)
    .flatMap((item) => Object.entries(item))
    .filter(([metodo]) => METODOS_HTTP.has(metodo))
    .reduce((total, [, operacao]) => total + operacao.tags.length, 0);
}

/** Responde /api/docs com os headers originais mais a CSP de produção. */
async function aplicarCspDeProducao(page: Page, csp: string): Promise<void> {
  await page.route(`**${ROTA_DA_DOCUMENTACAO}`, async (rota) => {
    const resposta = await rota.fetch({ maxRedirects: 0 });
    await rota.fulfill({
      response: resposta,
      headers: { ...resposta.headers(), 'content-security-policy': csp },
    });
  });
}

/** Mensagens de violação de CSP no console (o Chromium as registra como erro). */
function coletarViolacoesDeCsp(page: Page): string[] {
  const violacoes: string[] = [];
  page.on('console', (mensagem) => {
    if (VIOLACAO_DE_CSP.test(mensagem.text())) {
      violacoes.push(mensagem.text());
    }
  });
  return violacoes;
}

test.beforeEach(async () => {
  await limparRateLimit();
});

test('Swagger UI em /api/docs lista as operações e o "Try it out" de /api/health/live devolve 200, sem violação de CSP', async ({
  page,
  baseURL,
}) => {
  const csp = cspDoCaddyfile();
  const contrato = lerContrato();
  const violacoes = coletarViolacoesDeCsp(page);
  await aplicarCspDeProducao(page, csp);

  const documento = await page.goto(ROTA_DA_DOCUMENTACAO);

  // A página chegou com a CSP de produção (senão a checagem de CSP abaixo seria vazia).
  expect(documento?.status()).toBe(200);
  expect(documento?.headers()['content-security-policy']).toBe(csp);

  // Lista de operações: cada tag do contrato e um bloco por operação e tag.
  for (const { name } of contrato.tags) {
    await expect(page.locator(`#operations-tag-${name}`)).toBeVisible();
  }
  await expect(page.locator('.opblock')).toHaveCount(blocosDeOperacaoEsperados(contrato));

  // "Try it out" de GET /api/health/live.
  const operacao = page.locator('#operations-health-healthLive');
  await operacao.getByRole('button', { name: /GET\s*\/api\/health\/live/ }).click();
  await operacao.getByRole('button', { name: 'Try it out' }).click();
  const respostaDoHealth = page.waitForResponse(
    (r) => new URL(r.url()).pathname === ROTA_DO_HEALTH_LIVE,
  );
  await operacao.getByRole('button', { name: 'Execute' }).click();
  const resposta = await respostaDoHealth;

  // Mesma origem da página (servers: [{ url: / }], ADR 0036 item 6), nunca /api/api nem outro host.
  expect(resposta.url()).toBe(new URL(ROTA_DO_HEALTH_LIVE, baseURL).href);
  expect(resposta.status()).toBe(200);
  await expect(operacao.locator('.live-responses-table tbody .response-col_status')).toHaveText(
    '200',
  );

  // Soft: uma violação reprova o teste, mas o axe informativo abaixo ainda roda.
  expect.soft(violacoes, 'violações de CSP no console').toEqual([]);

  // axe informativo (task 146): UI de terceiros, não bloqueia; vai como anotação no relatório.
  test.info().annotations.push({
    type: 'axe (informativo)',
    description: JSON.stringify(await violacoesBloqueantes(page)),
  });
});
