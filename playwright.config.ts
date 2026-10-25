// Playwright (task 041, specs/013 §E2E): Chromium nos temas claro e escuro, API e web nas portas
// padrão (13000 e 15173) e o banco do worktree (leilao_test_<sufixo>). Dois e2e simultâneos em
// worktrees diferentes não são suportados: porta ocupada = falha citando a URL/porta.
import { defineConfig, devices } from '@playwright/test';

import { nomeDoBancoDoWorktree } from './apps/api/test/setup/banco-de-teste.js';

const PORTA_DA_API = 13000;
const PORTA_DA_WEB = 15173;
const ORIGEM_DA_WEB = `http://localhost:${PORTA_DA_WEB}`;
const ESPERA_DO_SERVIDOR_MS = 120_000;
// O Playwright sobe os webServers ANTES do globalSetup. Por isso o preparo do banco do worktree é
// o primeiro passo do comando da API (que só conecta depois dele). Aqui POSTGRES_DB é o banco de
// dev (admin, não sensível); no resto do comando vale o banco do worktree.
const BANCO_ADMIN = process.env['POSTGRES_DB'] ?? '';
// Nome de banco seguro para ir no comando de shell (o valor é interpolado em PREPARAR_BANCO).
const NOME_DE_BANCO_VALIDO = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
if (!NOME_DE_BANCO_VALIDO.test(BANCO_ADMIN)) {
  throw new Error('playwright: POSTGRES_DB ausente ou com formato inválido de nome de banco');
}
// Scryfall falsa (task 052): processo próprio; a API aponta para ela por SCRYFALL_BASE_URL e os
// specs a controlam (modo, contador) pela mesma porta, lida de E2E_SCRYFALL_PORTA nos workers.
const PORTA_DA_SCRYFALL = 13100;
process.env['E2E_SCRYFALL_PORTA'] = String(PORTA_DA_SCRYFALL);
const URL_DA_SCRYFALL = `http://127.0.0.1:${PORTA_DA_SCRYFALL}`;
const PREPARAR_BANCO =
  `POSTGRES_DB=${BANCO_ADMIN} node --import ../../apps/api/src/db/resolver-ts.mjs ` +
  '../../e2e/preparar-banco.ts';

/** Env dos servidores: a API conecta como leilao_api (POSTGRES_API_USER) no banco do worktree. */
const envDosServidores = {
  ...(process.env as Record<string, string>),
  API_PORT: String(PORTA_DA_API),
  WEB_ORIGIN: ORIGEM_DA_WEB,
  POSTGRES_DB: nomeDoBancoDoWorktree(),
  SCRYFALL_BASE_URL: URL_DA_SCRYFALL,
  LOG_LEVEL: 'silent',
};

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  globalTeardown: './e2e/global-teardown.ts',
  forbidOnly: !!process.env['CI'],
  retries: 0,
  workers: 1,
  reporter: [['list']],
  outputDir: 'test-results',
  use: { baseURL: ORIGEM_DA_WEB, locale: 'pt-BR' },
  projects: [
    { name: 'tema-claro', use: { ...devices['Desktop Chrome'], colorScheme: 'light' } },
    { name: 'tema-escuro', use: { ...devices['Desktop Chrome'], colorScheme: 'dark' } },
  ],
  webServer: [
    {
      command: `node --import ./apps/api/src/db/resolver-ts.mjs ./e2e/apoio/scryfall-falsa-servidor.ts ${PORTA_DA_SCRYFALL}`,
      url: `${URL_DA_SCRYFALL}/__controle`,
      reuseExistingServer: false,
      timeout: ESPERA_DO_SERVIDOR_MS,
    },
    {
      command: `${PREPARAR_BANCO} && pnpm run build && node dist/main.js`,
      cwd: 'apps/api',
      url: `http://localhost:${PORTA_DA_API}/api/health/ready`,
      reuseExistingServer: false,
      timeout: ESPERA_DO_SERVIDOR_MS,
      env: envDosServidores,
    },
    {
      command: 'pnpm run dev',
      cwd: 'apps/web',
      url: ORIGEM_DA_WEB,
      reuseExistingServer: false,
      timeout: ESPERA_DO_SERVIDOR_MS,
      env: envDosServidores,
    },
  ],
});
