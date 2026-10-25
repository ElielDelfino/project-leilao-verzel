// e2e da saída da F2 (task 063, specs/PLAN.md): criar lote pelo painel com a Scryfall de pé e,
// com a Scryfall bloqueada, vitrine e detalhe seguem funcionando sem falar com ela. A Scryfall é
// a falsa (task 052), sem rede externa.
import { expect, test } from '@playwright/test';

import {
  cancelarLotePorSql,
  cartaDoTeste,
  criarLotePelaInterface,
  definirModoDaScryfallFalsa,
  entrarComoLeiloeiro,
  esperarImagemCarregada,
  lerScryfallFalsa,
  restaurarScryfall,
  tituloUnico,
  zerarContadorDaScryfallFalsa,
} from './apoio/lotes.js';
import { limparRateLimit } from './apoio/rate-limit.js';

const MENSAGEM_CATALOGO_INDISPONIVEL = 'A busca de cartas está indisponível agora.';

test.beforeEach(async () => {
  await limparRateLimit();
  await restaurarScryfall();
});

test.afterEach(async () => {
  await restaurarScryfall();
});

test('com a Scryfall de pé, o leiloeiro cria um lote que aparece ao vivo, no painel e com imagem', async ({
  page,
}, info) => {
  const carta = cartaDoTeste(info, 0);
  const titulo = tituloUnico('Lote ao vivo');
  await entrarComoLeiloeiro(page);

  const id = await criarLotePelaInterface(page, { carta, titulo });

  // Painel: a linha do lote, ao vivo.
  const linhaDoPainel = page
    .getByRole('row')
    .filter({ has: page.getByRole('link', { name: titulo }) });
  await expect(linhaDoPainel).toContainText('Ao vivo');

  // Vitrine: aba "Ao vivo" (padrão) com o lote e a imagem carregada.
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Ao vivo' })).toHaveAttribute('aria-selected', 'true');
  const cartao = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('link', { name: titulo }) });
  await expect(cartao).toBeVisible();
  await esperarImagemCarregada(cartao.getByRole('img', { name: `Carta ${carta}`, exact: true }));

  // Detalhe: imagem carregada.
  await page.goto(`/lotes/${id}`);
  await expect(page.getByRole('heading', { level: 1, name: titulo })).toBeVisible();
  await esperarImagemCarregada(page.getByRole('img', { name: `Carta ${carta}`, exact: true }));
});

test('com a Scryfall bloqueada, vitrine e detalhe abrem, a imagem carrega e ela não é chamada', async ({
  page,
}, info) => {
  const carta = cartaDoTeste(info, 1);
  const titulo = tituloUnico('Lote com Scryfall bloqueada');
  await entrarComoLeiloeiro(page);
  const id = await criarLotePelaInterface(page, { carta, titulo });

  await definirModoDaScryfallFalsa('bloqueada');
  await zerarContadorDaScryfallFalsa();

  await page.goto('/');
  const cartao = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('link', { name: titulo }) });
  await expect(cartao).toBeVisible();
  await esperarImagemCarregada(cartao.getByRole('img', { name: `Carta ${carta}`, exact: true }));

  await page.goto(`/lotes/${id}`);
  await expect(page.getByRole('heading', { level: 1, name: titulo })).toBeVisible();
  await esperarImagemCarregada(page.getByRole('img', { name: `Carta ${carta}`, exact: true }));

  // Nenhuma requisição chegou à Scryfall durante a navegação pública.
  const estado = await lerScryfallFalsa();
  expect(estado.modo).toBe('bloqueada');
  expect(estado.total).toBe(0);

  // A busca do painel, em contraste, depende dela e mostra a mensagem de CATALOGO_INDISPONIVEL.
  await page.goto('/painel/lotes/novo');
  await page.getByLabel('Buscar carta na Scryfall').fill(`bloqueada ${Date.now()}`);
  await page.getByRole('button', { name: 'Buscar cartas' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: MENSAGEM_CATALOGO_INDISPONIVEL }),
  ).toBeVisible();
});

test('lote cancelado some da vitrine e continua no painel', async ({ page }, info) => {
  const carta = cartaDoTeste(info, 2);
  const titulo = tituloUnico('Lote a cancelar');
  await entrarComoLeiloeiro(page);
  const id = await criarLotePelaInterface(page, { carta, titulo });

  await page.goto('/');
  await expect(page.getByRole('link', { name: titulo, exact: true })).toBeVisible();

  await cancelarLotePorSql(id);

  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Ao vivo' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel')).not.toContainText('Carregando lotes');
  await expect(page.getByRole('link', { name: titulo, exact: true })).toHaveCount(0);

  await page.goto('/painel');
  const linhaDoPainel = page
    .getByRole('row')
    .filter({ has: page.getByRole('link', { name: titulo }) });
  await expect(linhaDoPainel).toContainText('Cancelado');
});
