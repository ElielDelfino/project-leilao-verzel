// Passos de sessão pela interface, reaproveitados pelos specs do e2e (task 043).
import { randomUUID } from 'node:crypto';

import { expect, type Page } from '@playwright/test';

export const SENHA_DE_TESTE = 'senha-de-teste-123';
export const LEILOEIRO_DO_SEED = 'leiloeiro@demo.local';
export const LICITANTE_DO_SEED = 'helena@demo.local';

export function emailNovo(): string {
  return `e2e-${randomUUID()}@teste.local`;
}

/** A senha das contas demo vem do SEED_DEMO_PASSWORD do .env (nunca fixa no código). */
export function senhaDoSeed(): string {
  const senha = process.env['SEED_DEMO_PASSWORD'];
  if (senha === undefined || senha === '') {
    throw new Error('e2e: variável SEED_DEMO_PASSWORD ausente');
  }
  return senha;
}

/** Cadastra um licitante pelo formulário; termina logado (botão "Sair" visível). */
export async function cadastrarLicitante(page: Page, email: string): Promise<void> {
  await page.goto('/cadastro');
  await page.getByLabel('Nome', { exact: true }).fill('Licitante E2E');
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(SENHA_DE_TESTE);
  await page.getByLabel('Licitante', { exact: true }).check();
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await expect(page.getByRole('button', { name: 'Sair' })).toBeVisible();
}

/** Entra pelo formulário de /entrar; termina logado (botão "Sair" visível). */
export async function entrarPelaInterface(page: Page, email: string, senha: string): Promise<void> {
  await page.goto('/entrar');
  await preencherLogin(page, email, senha);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sair' })).toBeVisible();
}

export async function preencherLogin(page: Page, email: string, senha: string): Promise<void> {
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(senha);
}
