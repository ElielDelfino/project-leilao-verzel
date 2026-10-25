// e2e da saída da F3 (task 091, specs/PLAN.md, specs/007, 009 e 012): dois navegadores disputando
// um lote, fim estendido, recusas na tela e convergência depois de uma queda de rede. Cada teste
// cria o próprio lote (carta própria); os navegadores logados são criados uma vez por projeto
// (login tem limite de 5/min por conta). Scryfall falsa, sem rede externa.
import { expect, test, type BrowserContext } from '@playwright/test';

import {
  abrirSala,
  abrirSalaComoLicitante,
  aproximarFimDoLotePorSql,
  BRUNO_DO_SEED,
  controlarSocketDaPagina,
  darLancePelaInterface,
  esperarLanceMinimo,
  esperarLanceRegistrado,
  fecharContextos,
  indicadorDePosicao,
  lerMarca,
  limparRateLimitDasContas,
  type Navegador,
  observarCliques,
  observarSuperado,
  prepararLeiloeiro,
  prepararLicitanteDoSeed,
  prepararLicitanteNovo,
  recusaDoLance,
  segundosRestantes,
  texto,
} from './apoio/lances.js';
import {
  cartaDoTeste,
  criarLotePelaInterface,
  restaurarScryfall,
  tituloUnico,
} from './apoio/lotes.js';
import { LEILOEIRO_DO_SEED, LICITANTE_DO_SEED } from './apoio/sessao.js';

// Índices de carta próprios deste arquivo (lotes.spec usa 0–2; acessibilidade.spec, 4–5 e 20–21).
const CARTA = {
  superado: 6,
  fimEstendido: 7,
  abaixoDoMinimo: 8,
  saldoInsuficiente: 9,
  liderCobrindoOProprioLance: 10,
  leiloeiro: 11,
  quedaDeRede: 12,
  seloDoFimEstendido: 13,
} as const;

const DEPOSITO_DOS_LICITANTES = '1000,00';
const LIMITE_DO_SUPERADO_MS = 1000;
const SEGUNDOS_ATE_O_FIM_NO_ANTI_SNIPING = 100;
const ESPERA_DA_RECONEXAO_MS = 30_000;

test.describe('sala ao vivo com dois navegadores', () => {
  test.describe.configure({ timeout: 90_000 });

  const abertos: BrowserContext[] = [];
  let leiloeiro: Navegador;
  let ana: Navegador;
  let bruno: Navegador;

  test.beforeAll(async ({ browser }, info) => {
    await limparRateLimitDasContas([LEILOEIRO_DO_SEED, LICITANTE_DO_SEED, BRUNO_DO_SEED]);
    await restaurarScryfall();
    leiloeiro = await prepararLeiloeiro(browser, info);
    abertos.push(leiloeiro.contexto);
    ana = await prepararLicitanteDoSeed(browser, info, LICITANTE_DO_SEED, DEPOSITO_DOS_LICITANTES);
    abertos.push(ana.contexto);
    bruno = await prepararLicitanteDoSeed(browser, info, BRUNO_DO_SEED, DEPOSITO_DOS_LICITANTES);
    abertos.push(bruno.contexto);
  });

  test.afterAll(async () => {
    await fecharContextos(abertos);
  });

  test.beforeEach(async () => {
    await restaurarScryfall();
  });

  async function criarLote(indice: number, rotulo: string): Promise<string> {
    return criarLotePelaInterface(leiloeiro.pagina, {
      carta: cartaDoTeste(test.info(), indice),
      titulo: tituloUnico(rotulo),
    });
  }

  test('A lidera, B supera: A vê "você foi superado" em menos de 1 s (relógio do navegador) e B vê "você está ganhando"', async () => {
    const loteId = await criarLote(CARTA.superado, 'Lote do superado');
    await abrirSalaComoLicitante(ana.pagina, loteId);
    await abrirSalaComoLicitante(bruno.pagina, loteId);

    await darLancePelaInterface(ana.pagina, '10,00');
    await esperarLanceRegistrado(ana.pagina, '10,00');
    await expect(indicadorDePosicao(ana.pagina, 'Você está ganhando este lote.')).toBeVisible();

    // B só lança o mínimo depois de receber o lance de A.
    await esperarLanceMinimo(bruno.pagina, '11,00');
    await observarSuperado(ana.pagina);
    await observarCliques(bruno.pagina);
    await darLancePelaInterface(bruno.pagina, '11,00');

    await expect
      .poll(() => lerMarca(ana.pagina, 'superadoEm'), { message: 'A não foi superada' })
      .toBeDefined();
    const superadoEm = await lerMarca(ana.pagina, 'superadoEm');
    const cliqueEm = await lerMarca(bruno.pagina, 'cliqueEm');
    expect(superadoEm).toBeDefined();
    expect(cliqueEm).toBeDefined();
    // As duas marcas usam `performance.timeOrigin + performance.now()` (mesmo navegador): o
    // "superado" não pode vir antes do clique (delta ≥ 0) e tem de vir em menos de 1 s.
    const delta = (superadoEm ?? Number.NaN) - (cliqueEm ?? Number.NaN);
    expect(delta).toBeGreaterThanOrEqual(0);
    expect(delta).toBeLessThan(LIMITE_DO_SUPERADO_MS);

    await expect(
      indicadorDePosicao(ana.pagina, 'Você foi superado. O lance atual é R$ 11,00.'),
    ).toBeVisible();
    await expect(indicadorDePosicao(bruno.pagina, 'Você está ganhando este lote.')).toBeVisible();
    await esperarLanceRegistrado(bruno.pagina, '11,00');
  });

  /** Lote a ~100 s do fim, com A e B na sala (fim por SQL ANTES de abrir a sala). */
  async function abrirDisputaPertoDoFim(indice: number, rotulo: string) {
    const loteId = await criarLote(indice, rotulo);
    await aproximarFimDoLotePorSql(loteId, SEGUNDOS_ATE_O_FIM_NO_ANTI_SNIPING);
    await abrirSalaComoLicitante(ana.pagina, loteId);
    await abrirSalaComoLicitante(bruno.pagina, loteId);
    return {
      restanteDeAna: await segundosRestantes(ana.pagina),
      restanteDeBruno: await segundosRestantes(bruno.pagina),
    };
  }

  test('fim estendido mostra o selo "Fim estendido" e anuncia o novo fim (specs/012)', async () => {
    await abrirDisputaPertoDoFim(CARTA.seloDoFimEstendido, 'Lote do selo do fim estendido');

    await darLancePelaInterface(ana.pagina, '10,00');
    await esperarLanceRegistrado(ana.pagina, '10,00');

    for (const { pagina } of [ana, bruno]) {
      // O selo é "⏱ Fim estendido" (o ícone é um span aria-hidden dentro do mesmo <p>).
      await expect(pagina.getByText(/Fim estendido/)).toBeVisible();
      await expect(
        pagina.getByRole('status').filter({ hasText: 'O fim do lote foi estendido para' }),
      ).toBeVisible();
    }
  });

  // Cobre o evento `lance_aceito` e o `fim_estendido` (a contagem dos dois navegadores passa a
  // refletir o fim novo) e o resync do `entrar_lote` ao abrir a sala; o selo e o aviso ficam no
  // teste anterior.
  test('lance a menos de 2 min do fim estende o fim e muda a contagem nos dois navegadores', async () => {
    const { restanteDeAna, restanteDeBruno } = await abrirDisputaPertoDoFim(
      CARTA.fimEstendido,
      'Lote do fim estendido',
    );
    expect(restanteDeAna).toBeGreaterThan(0);
    expect(restanteDeAna).toBeLessThanOrEqual(SEGUNDOS_ATE_O_FIM_NO_ANTI_SNIPING);
    expect(restanteDeBruno).toBeGreaterThan(0);

    await darLancePelaInterface(ana.pagina, '10,00');
    await esperarLanceRegistrado(ana.pagina, '10,00');

    // O fim novo é agora + 2 min: a contagem passa a ser maior do que era antes do lance, nos dois.
    await expect
      .poll(() => segundosRestantes(ana.pagina), { message: 'contagem de A não cresceu' })
      .toBeGreaterThan(restanteDeAna);
    await expect
      .poll(() => segundosRestantes(bruno.pagina), { message: 'contagem de B não cresceu' })
      .toBeGreaterThan(restanteDeBruno);
    for (const { pagina } of [ana, bruno]) {
      await expect(pagina.getByText(/^Fim original:/)).toBeVisible();
    }
  });

  test('lance abaixo do mínimo mostra a recusa e leva o campo ao mínimo', async () => {
    const loteId = await criarLote(CARTA.abaixoDoMinimo, 'Lote abaixo do mínimo');
    await abrirSalaComoLicitante(ana.pagina, loteId);

    await darLancePelaInterface(ana.pagina, '5,00');

    await expect(
      recusaDoLance(ana.pagina, 'Seu lance precisa ser de pelo menos R$ 10,00.'),
    ).toBeVisible();
    await expect(ana.pagina.getByLabel('Valor do lance (R$)')).toHaveValue('10,00');
    await expect(ana.pagina.getByText(texto('Nenhum lance ainda.')).first()).toBeVisible();
  });

  test('saldo insuficiente mostra a recusa com o saldo disponível e o atalho para a carteira', async ({
    browser,
  }, info) => {
    const loteId = await criarLote(CARTA.saldoInsuficiente, 'Lote de saldo insuficiente');
    let pobre: Navegador | undefined;
    try {
      pobre = await prepararLicitanteNovo(browser, info, '12,00');
      await abrirSalaComoLicitante(pobre.pagina, loteId);

      await darLancePelaInterface(pobre.pagina, '15,00');

      const recusa = recusaDoLance(
        pobre.pagina,
        'Saldo disponível insuficiente: você tem R$ 12,00.',
      );
      await expect(recusa).toBeVisible();
      await expect(recusa.getByRole('link', { name: 'Ir para a carteira' })).toBeVisible();
    } finally {
      await pobre?.contexto.close();
    }
  });

  test('o líder que cobre o próprio lance é recusado ("você já está ganhando")', async () => {
    const loteId = await criarLote(CARTA.liderCobrindoOProprioLance, 'Lote do líder');
    await abrirSalaComoLicitante(ana.pagina, loteId);

    await darLancePelaInterface(ana.pagina, '10,00');
    await esperarLanceRegistrado(ana.pagina, '10,00');
    await esperarLanceMinimo(ana.pagina, '11,00');
    await darLancePelaInterface(ana.pagina, '11,00');

    await expect(recusaDoLance(ana.pagina, 'Você já está ganhando este lote.')).toBeVisible();
    await expect(indicadorDePosicao(ana.pagina, 'Você está ganhando este lote.')).toBeVisible();
    await expect(ana.pagina.getByText(texto('Lance atual: R$ 10,00'))).toBeVisible();
  });

  test('o leiloeiro não vê o formulário de lance', async () => {
    const loteId = await criarLote(CARTA.leiloeiro, 'Lote sem lance do leiloeiro');

    await abrirSala(leiloeiro.pagina, loteId);

    await expect(leiloeiro.pagina.getByText('Leiloeiros não podem dar lances.')).toBeVisible();
    await expect(leiloeiro.pagina.getByRole('form', { name: 'Dar lance' })).toHaveCount(0);
    await expect(leiloeiro.pagina.getByLabel('Valor do lance (R$)')).toHaveCount(0);
  });

  test('sem conexão, A perde o lance de B e, ao voltar, o estado converge', async () => {
    const loteId = await criarLote(CARTA.quedaDeRede, 'Lote da queda de rede');
    // Página própria de A (mesma sessão) com o socket sob controle; fechada no fim.
    const paginaDeAna = await ana.contexto.newPage();
    const socket = await controlarSocketDaPagina(paginaDeAna);
    try {
      await abrirSalaComoLicitante(paginaDeAna, loteId);
      await abrirSalaComoLicitante(bruno.pagina, loteId);
      await darLancePelaInterface(paginaDeAna, '10,00');
      await esperarLanceRegistrado(paginaDeAna, '10,00');
      await esperarLanceMinimo(bruno.pagina, '11,00');

      socket.derrubar();
      await expect(paginaDeAna.getByText(texto('Reconectando…'))).toBeVisible();
      await expect(paginaDeAna.getByLabel('Valor do lance (R$)')).toBeDisabled();

      await darLancePelaInterface(bruno.pagina, '11,00');
      await esperarLanceRegistrado(bruno.pagina, '11,00');
      // Enquanto caída, A não sabe do lance de B.
      await expect(paginaDeAna.getByText(texto('Lance atual: R$ 10,00'))).toBeVisible();

      socket.restaurar();
      // Reconexão com o backoff do socket, depois o resync do `entrar_lote`.
      await expect(
        indicadorDePosicao(paginaDeAna, 'Você foi superado. O lance atual é R$ 11,00.'),
      ).toBeVisible({ timeout: ESPERA_DA_RECONEXAO_MS });
      await expect(paginaDeAna.getByText(texto('Lance atual: R$ 11,00'))).toBeVisible();
      await expect(paginaDeAna.getByText(texto('Reconectando…'))).toHaveCount(0);
      await expect(paginaDeAna.getByLabel('Valor do lance (R$)')).toBeEnabled();
      await expect(paginaDeAna.getByText(texto('Lance mínimo: R$ 12,00'))).toBeVisible();
    } finally {
      socket.restaurar();
      await paginaDeAna.close();
    }
  });
});
