// axe-core em todas as rotas de specs/012 §Rotas, nos dois temas, como anônimo (task 041).
// Zero violações com impacto serious ou critical (WCAG 2.0/2.1/2.2 A e AA).
import { expect, test } from '@playwright/test';

import { aguardarEstadoEstavel, violacoesBloqueantes } from './apoio/axe.js';
import { limparRateLimit } from './apoio/rate-limit.js';

const UUID_FIXO = '00000000-0000-4000-8000-000000000001';
const CODIGO_DO_COMPROVANTE = 'ABCDEFGHJKLMNPQR';

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
    await expect(page.locator('html')).toHaveAttribute('data-theme', tema);
    // Rotas restritas redirecionam o anônimo para /entrar; o axe roda na tela que ficou.
    await aguardarEstadoEstavel(page);

    expect(await violacoesBloqueantes(page)).toEqual([]);
  });
}
