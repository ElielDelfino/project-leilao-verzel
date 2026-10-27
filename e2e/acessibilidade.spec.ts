// axe-core em todas as rotas de specs/012 §Rotas, nos dois temas, como anônimo (task 041).
// Zero violações com impacto serious ou critical (WCAG 2.0/2.1/2.2 A e AA).
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { aguardarEstadoEstavel, violacoesBloqueantes } from './apoio/axe.js';
import {
  abrirSala,
  abrirSalaComoLicitante,
  OTAVIO_DO_SEED,
  darLancePelaInterface,
  esperarLanceMinimo,
  esperarLanceRegistrado,
  fecharContextos,
  indicadorDePosicao,
  limparRateLimitDasContas,
  type Navegador,
  prepararLeiloeiro,
  prepararLicitanteDoSeed,
  recusaDoLance,
  texto,
} from './apoio/lances.js';
import {
  cartaDoTeste,
  criarLotePelaInterface,
  entrarComoLeiloeiro,
  opcoesDoContexto,
  restaurarScryfall,
  tituloUnico,
} from './apoio/lotes.js';
import { limparRateLimit } from './apoio/rate-limit.js';
import { LEILOEIRO_DO_SEED, LICITANTE_DO_SEED } from './apoio/sessao.js';

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

// Rotas da F2 com dados reais (task 063): um lote ao vivo criado pela interface; o leiloeiro
// logado vê o painel com a linha do lote e o passo 1 do novo lote; o anônimo vê vitrine e sala.
test.describe('com dados (F2)', () => {
  const INDICE_DA_CARTA = 4;
  let contexto: BrowserContext;
  let paginaDoLeiloeiro: Page;
  let loteId = '';

  test.beforeAll(async ({ browser }, info) => {
    await limparRateLimit();
    await restaurarScryfall();
    contexto = await browser.newContext(opcoesDoContexto(info));
    paginaDoLeiloeiro = await contexto.newPage();
    await entrarComoLeiloeiro(paginaDoLeiloeiro);
    loteId = await criarLotePelaInterface(paginaDoLeiloeiro, {
      carta: cartaDoTeste(info, INDICE_DA_CARTA),
      titulo: tituloUnico('Lote de acessibilidade'),
    });
  });

  test.afterAll(async () => {
    await contexto.close();
  });

  const ROTAS_COM_DADOS: readonly { nome: string; caminho: () => string }[] = [
    { nome: 'vitrine', caminho: () => '/' },
    { nome: 'sala do lote', caminho: () => `/lotes/${loteId}` },
    { nome: 'painel', caminho: () => '/painel' },
    { nome: 'novo lote (busca)', caminho: () => '/painel/lotes/novo' },
  ];

  for (const rota of ROTAS_COM_DADOS) {
    test(`${rota.nome} com dados sem violações sérias de acessibilidade`, async () => {
      const info = test.info();
      const tema = info.project.name === 'tema-escuro' ? 'dark' : 'light';

      await paginaDoLeiloeiro.goto(rota.caminho());
      await expect(paginaDoLeiloeiro.locator('html')).toHaveAttribute('data-theme', tema);
      await expect(paginaDoLeiloeiro.getByText(/Carregando/)).toHaveCount(0);
      await aguardarEstadoEstavel(paginaDoLeiloeiro);

      expect(await violacoesBloqueantes(paginaDoLeiloeiro)).toEqual([]);
    });
  }

  test('novo lote (dados do lote, passo 2) sem violações sérias de acessibilidade', async () => {
    const info = test.info();
    const tema = info.project.name === 'tema-escuro' ? 'dark' : 'light';
    const carta = cartaDoTeste(info, INDICE_DA_CARTA + 1);

    await paginaDoLeiloeiro.goto('/painel/lotes/novo');
    await paginaDoLeiloeiro.getByLabel('Buscar carta na Scryfall').fill(carta);
    await paginaDoLeiloeiro.getByRole('button', { name: 'Buscar cartas' }).click();
    await paginaDoLeiloeiro.getByRole('button', { name: `Escolher ${carta}` }).click();
    await expect(paginaDoLeiloeiro.getByRole('heading', { name: 'Dados do lote' })).toBeVisible();
    await expect(paginaDoLeiloeiro.locator('html')).toHaveAttribute('data-theme', tema);
    await aguardarEstadoEstavel(paginaDoLeiloeiro);

    expect(await violacoesBloqueantes(paginaDoLeiloeiro)).toEqual([]);
  });
});

// Sala ao vivo com lances (task 091, nota da 005): lote com dois lances (helena superada, otavio
// ganhando), nos dois temas. Cada visão reabre a sala, que recompõe a posição pelo `entrar_lote`.
test.describe('sala ao vivo (F3)', () => {
  const INDICE_DA_CARTA = 20;
  const abertos: BrowserContext[] = [];
  let leiloeiro: Navegador;
  let helena: Navegador;
  let otavio: Navegador;
  let loteId = '';

  test.beforeAll(async ({ browser }, info) => {
    test.setTimeout(120_000);
    await limparRateLimitDasContas([LEILOEIRO_DO_SEED, LICITANTE_DO_SEED, OTAVIO_DO_SEED]);
    await restaurarScryfall();
    leiloeiro = await prepararLeiloeiro(browser, info);
    abertos.push(leiloeiro.contexto);
    helena = await prepararLicitanteDoSeed(browser, info, LICITANTE_DO_SEED, '1000,00');
    abertos.push(helena.contexto);
    otavio = await prepararLicitanteDoSeed(browser, info, OTAVIO_DO_SEED, '1000,00');
    abertos.push(otavio.contexto);

    loteId = await criarLotePelaInterface(leiloeiro.pagina, {
      carta: cartaDoTeste(info, INDICE_DA_CARTA),
      titulo: tituloUnico('Lote de acessibilidade da sala'),
    });
    await abrirSalaComoLicitante(helena.pagina, loteId);
    await abrirSalaComoLicitante(otavio.pagina, loteId);
    await darLancePelaInterface(helena.pagina, '10,00');
    await esperarLanceRegistrado(helena.pagina, '10,00');
    await esperarLanceMinimo(otavio.pagina, '11,00');
    await darLancePelaInterface(otavio.pagina, '11,00');
    await esperarLanceRegistrado(otavio.pagina, '11,00');
  });

  test.afterAll(async () => {
    await fecharContextos(abertos);
  });

  async function verificar(page: Page): Promise<void> {
    const tema = test.info().project.name === 'tema-escuro' ? 'dark' : 'light';
    await expect(page.locator('html')).toHaveAttribute('data-theme', tema);
    await aguardarEstadoEstavel(page);
    expect(await violacoesBloqueantes(page)).toEqual([]);
  }

  test('sala com lances, vista pelo leiloeiro, sem violações sérias de acessibilidade', async () => {
    await abrirSala(leiloeiro.pagina, loteId);
    await expect(leiloeiro.pagina.getByText(texto('Lance atual: R$ 11,00'))).toBeVisible();
    await expect(
      leiloeiro.pagina.locator('section[aria-labelledby="historico-titulo"] ol li'),
    ).toHaveCount(2);

    await verificar(leiloeiro.pagina);
  });

  test('sala com "você está ganhando" sem violações sérias de acessibilidade', async () => {
    await abrirSalaComoLicitante(otavio.pagina, loteId);
    await expect(indicadorDePosicao(otavio.pagina, 'Você está ganhando este lote.')).toBeVisible();

    await verificar(otavio.pagina);
  });

  test('sala com "você foi superado" sem violações sérias de acessibilidade', async () => {
    await abrirSalaComoLicitante(helena.pagina, loteId);
    await expect(
      indicadorDePosicao(helena.pagina, 'Você foi superado. O lance atual é R$ 11,00.'),
    ).toBeVisible();

    await verificar(helena.pagina);
  });

  test('sala com a recusa do lance exibida sem violações sérias de acessibilidade', async () => {
    await abrirSalaComoLicitante(helena.pagina, loteId);
    await darLancePelaInterface(helena.pagina, '5,00');
    await expect(
      recusaDoLance(helena.pagina, 'Seu lance precisa ser de pelo menos R$ 12,00.'),
    ).toBeVisible();

    await verificar(helena.pagina);
  });
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
