// axe-core em todas as rotas de specs/012 §Rotas, nos dois temas, como anônimo (task 041).
// Zero violações com impacto serious ou critical (WCAG 2.0/2.1/2.2 A e AA).
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { limparRateLimit } from './apoio/rate-limit.js';

const UUID_FIXO = '00000000-0000-4000-8000-000000000001';
const CODIGO_DO_COMPROVANTE = 'ABCDEFGHJKLMNPQR';
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const IMPACTOS_BLOQUEANTES = new Set(['serious', 'critical']);

const ROTAS: readonly { nome: string; caminho: string }[] = [
  { nome: 'vitrine', caminho: '/' },
  { nome: 'sala do lote', caminho: `/lotes/${UUID_FIXO}` },
  { nome: 'entrar', caminho: '/entrar' },
  { nome: 'cadastro', caminho: '/cadastro' },
  { nome: 'carteira', caminho: '/carteira' },
  { nome: 'meus arremates', caminho: '/meus-arremates' },
  { nome: 'painel', caminho: '/painel' },
  { nome: 'novo lote', caminho: '/painel/lotes/novo' },
  { nome: 'auditoria', caminho: `/auditoria/${UUID_FIXO}` },
  { nome: 'comprovante', caminho: `/comprovantes/${CODIGO_DO_COMPROVANTE}` },
  { nome: '404', caminho: '/nao-existe' },
];

test.beforeEach(async () => {
  await limparRateLimit();
});

for (const rota of ROTAS) {
  test(`${rota.nome} (${rota.caminho}) sem violações sérias de acessibilidade`, async ({
    page,
  }, info) => {
    const tema = info.project.name === 'tema-escuro' ? 'dark' : 'light';

    await page.goto(rota.caminho);
    await expect(page.locator('main#conteudo')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', tema);
    // Rotas restritas redirecionam o anônimo para /entrar; o axe roda na tela que ficou.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    const resultado = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    const bloqueantes = resultado.violations
      .filter((v) => v.impact != null && IMPACTOS_BLOQUEANTES.has(v.impact))
      .map((v) => ({
        regra: v.id,
        impacto: v.impact,
        nos: v.nodes.map((n) => n.target.join(' ')),
      }));
    expect(bloqueantes).toEqual([]);
  });
}
