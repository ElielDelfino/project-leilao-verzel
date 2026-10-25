// e2e da F1 (task 043, specs/013 §E2E, specs/003, specs/004, specs/012): fluxo de conta e carteira,
// rate limit de login, sessão expirada, papel sem permissão e axe autenticado nos dois temas.
import { expect, test } from '@playwright/test';

import { aguardarEstadoEstavel, violacoesBloqueantes } from './apoio/axe.js';
import { limparRateLimit } from './apoio/rate-limit.js';
import {
  cadastrarLicitante,
  emailNovo,
  entrarPelaInterface,
  LEILOEIRO_DO_SEED,
  LICITANTE_DO_SEED,
  preencherLogin,
  SENHA_DE_TESTE,
  senhaDoSeed,
} from './apoio/sessao.js';

const BOTAO_ENTRAR = { name: 'Entrar', exact: true } as const;

test.beforeEach(async () => {
  await limparRateLimit();
});

test('cadastro → logout → login → depósito → saldo pela interface', async ({ page }) => {
  const email = emailNovo();
  await cadastrarLicitante(page, email);

  await page.getByRole('button', { name: 'Sair' }).click();
  await expect(page.getByRole('link', BOTAO_ENTRAR)).toBeVisible();

  await entrarPelaInterface(page, email, SENHA_DE_TESTE);
  await page.getByRole('link', { name: 'Carteira' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Carteira' })).toBeVisible();

  await page.getByLabel('Valor do depósito (R$)').fill('25,00');
  await page.getByRole('button', { name: 'Depositar' }).click();

  await expect(page.getByRole('status').filter({ hasText: 'Depósito de' })).toHaveText(
    /^Depósito de R\$\s25,00 registrado\.$/,
  );
  await expect(
    page.getByText('Total', { exact: true }).locator('xpath=following-sibling::dd'),
  ).toHaveText(/R\$\s25,00/);
  await expect(page.getByRole('cell', { name: 'Depósito', exact: true })).toBeVisible();
});

test('6 logins errados → "Muitas tentativas" com o valor do Retry-After', async ({ page }) => {
  await page.goto('/entrar');
  await preencherLogin(page, `inexistente-${emailNovo()}`, 'senha-errada-123');
  const enviar = async () => {
    const [resposta] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/auth/login')),
      page.getByRole('button', BOTAO_ENTRAR).click(),
    ]);
    return resposta;
  };

  for (let tentativa = 1; tentativa <= 5; tentativa++) {
    expect((await enviar()).status()).toBe(401);
  }
  await expect(page.getByRole('alert')).toHaveText('E-mail ou senha incorretos.');

  const sexta = await enviar();
  expect(sexta.status()).toBe(429);
  const segundos = sexta.headers()['retry-after'];
  expect(segundos).toMatch(/^[1-9]\d*$/);
  await expect(page.getByRole('alert')).toHaveText(
    `Muitas tentativas. Tente de novo em ${segundos} s.`,
  );
});

test('sessão expirada (cookies apagados, refresh recusado) → /entrar com a mensagem', async ({
  page,
  context,
}) => {
  await entrarPelaInterface(page, LICITANTE_DO_SEED, senhaDoSeed());
  await page.getByRole('link', { name: 'Carteira' }).click();
  await aguardarEstadoEstavel(page);

  await context.clearCookies();
  // Gatilho determinístico: o TanStack Query refaz as consultas ao voltar a visibilidade da aba;
  // sem cookies a consulta recebe 401, o refresh é recusado e a sessão expira.
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

  await expect(page).toHaveURL(/\/entrar\?retorno=%2Fcarteira/);
  await expect(page.getByText('Sua sessão expirou. Entre novamente.')).toBeVisible();
});

test('leiloeiro do seed em /carteira → "Sua conta não tem permissão para esta ação."', async ({
  page,
}) => {
  await entrarPelaInterface(page, LEILOEIRO_DO_SEED, senhaDoSeed());

  await page.goto('/carteira');

  await expect(page.getByRole('heading', { level: 1, name: 'Acesso não permitido' })).toBeVisible();
  await expect(page.getByText('Sua conta não tem permissão para esta ação.')).toBeVisible();
});

test('axe autenticado em /carteira sem violações sérias', async ({ page }, info) => {
  const tema = info.project.name === 'tema-escuro' ? 'dark' : 'light';
  await entrarPelaInterface(page, LICITANTE_DO_SEED, senhaDoSeed());
  await page.getByRole('link', { name: 'Carteira' }).click();

  await expect(page.locator('html')).toHaveAttribute('data-theme', tema);
  await aguardarEstadoEstavel(page);
  await expect(page.getByRole('heading', { level: 2, name: 'Extrato' })).toBeVisible();

  expect(await violacoesBloqueantes(page)).toEqual([]);
});
