// Teste negativo do axe (task 043, revisão da 041): prova que a checagem enxerga um problema real.
// Baixo contraste injetado na página tem de aparecer como `color-contrast` (impacto serious).
import { expect, test } from '@playwright/test';

import { aguardarEstadoEstavel, violacoesBloqueantes } from './apoio/axe.js';

test('baixo contraste injetado é detectado como color-contrast', async ({ page }) => {
  await page.goto('/entrar');
  await aguardarEstadoEstavel(page);
  await page.evaluate(() => {
    const p = document.createElement('p');
    p.textContent = 'Texto cinza claro sobre fundo branco';
    p.style.cssText = 'color:#cccccc;background:#ffffff';
    document.querySelector('main#conteudo')?.append(p);
  });

  const regras = (await violacoesBloqueantes(page)).map((v) => v.regra);

  expect(regras).toContain('color-contrast');
});
