// Passos e controles de lotes para o e2e da F2 (task 063): criação pela interface, controle da
// Scryfall falsa (task 052), cancelamento por SQL e reset do circuito da Scryfall no Redis.
import { createRequire } from 'node:module';

import { expect, type BrowserContextOptions, type Page, type TestInfo } from '@playwright/test';
import type { Client as ClientePg } from 'pg';

import { lerConexaoDoBanco, trocarBanco } from '../../apps/api/src/db/conexao.js';
import { nomeDoBancoDoWorktree } from '../../apps/api/test/setup/banco-de-teste.js';
import { entrarPelaInterface, LEILOEIRO_DO_SEED, senhaDoSeed } from './sessao.js';

// `pg` e `redis` são dependências da API, não da raiz: resolvem a partir do pacote dela.
const daApi = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const { Client } = daApi('pg') as { Client: typeof ClientePg };

interface ClienteRedis {
  connect(): Promise<unknown>;
  del(chave: string): Promise<unknown>;
  destroy(): void;
}
const { createClient } = daApi('redis') as {
  createClient(opcoes: { socket: { host: string; port: number }; password: string }): ClienteRedis;
};

export type ModoDaScryfallFalsa = 'ok' | '429' | 'bloqueada';

export interface EstadoDaScryfallFalsa {
  modo: ModoDaScryfallFalsa;
  total: number;
}

/**
 * Prefixo Redis da Scryfall que a API do e2e usa (SCRYFALL_REDIS_PREFIX em playwright.config.ts,
 * task 099). Mesma regra fechada da env da API; qualquer outro valor (inclusive o `scryfall:` de
 * produção e dev) é recusado, para o e2e nunca apagar chaves que não são dele.
 */
const PREFIXO_REDIS_DO_E2E = /^scryfall:e2e[a-z0-9-]*:$/;
const HORAS_DE_DURACAO = 2;
const MS_POR_HORA = 3_600_000;

function variavel(nome: string): string {
  const valor = process.env[nome];
  if (valor === undefined || valor === '') {
    throw new Error(`e2e: variável ${nome} ausente`);
  }
  return valor;
}

function urlDoControle(): string {
  return `http://127.0.0.1:${variavel('E2E_SCRYFALL_PORTA')}/__controle`;
}

export async function lerScryfallFalsa(): Promise<EstadoDaScryfallFalsa> {
  const resposta = await fetch(urlDoControle());
  if (!resposta.ok) throw new Error(`e2e: controle da Scryfall falsa respondeu ${resposta.status}`);
  return (await resposta.json()) as EstadoDaScryfallFalsa;
}

async function enviarControle(corpo: { modo?: ModoDaScryfallFalsa; zerar?: true }): Promise<void> {
  const resposta = await fetch(urlDoControle(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  if (!resposta.ok) throw new Error(`e2e: controle da Scryfall falsa recusou (${resposta.status})`);
}

export async function definirModoDaScryfallFalsa(modo: ModoDaScryfallFalsa): Promise<void> {
  await enviarControle({ modo });
}

export async function zerarContadorDaScryfallFalsa(): Promise<void> {
  await enviarControle({ zerar: true });
}

/** Chave do circuito da Scryfall da API do e2e (`${prefixo}circuito`), com o prefixo validado. */
export function chaveDoCircuitoDoE2e(): string {
  const prefixo = variavel('E2E_SCRYFALL_PREFIXO_REDIS');
  if (!PREFIXO_REDIS_DO_E2E.test(prefixo)) {
    throw new Error('e2e: prefixo Redis da Scryfall fora do formato scryfall:e2e…:');
  }
  return `${prefixo}circuito`;
}

/** Volta ao estado limpo: modo `ok`, contador zerado e circuito fechado (só a chave dele). */
export async function restaurarScryfall(): Promise<void> {
  // Valida o prefixo antes de qualquer efeito.
  const chaveDoCircuito = chaveDoCircuitoDoE2e();
  await enviarControle({ modo: 'ok', zerar: true });
  const cliente = createClient({
    socket: { host: variavel('REDIS_HOST'), port: Number(variavel('REDIS_PORT')) },
    password: variavel('REDIS_PASSWORD'),
  });
  await cliente.connect();
  try {
    await cliente.del(chaveDoCircuito);
  } finally {
    cliente.destroy();
  }
}

/**
 * Carta sintética própria de cada teste e tema: o catálogo falso tem "Carta Sintetica 001" etc., e
 * a busca por esse nome devolve uma só carta. Evita dois lotes da mesma carta no mesmo banco.
 */
export function cartaDoTeste(info: TestInfo, indiceDoTeste: number): string {
  const tema = info.project.name === 'tema-escuro' ? 1 : 0;
  return `Carta Sintetica ${String(indiceDoTeste * 2 + tema + 1).padStart(3, '0')}`;
}

export function tituloUnico(prefixo: string): string {
  return `${prefixo} ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Valor de `<input type="datetime-local">` (hora local, sem fuso) daqui a `horas`. */
function fimEmHoras(horas: number): string {
  const instante = new Date(Date.now() + horas * MS_POR_HORA);
  const dois = (n: number) => String(n).padStart(2, '0');
  return (
    `${instante.getFullYear()}-${dois(instante.getMonth() + 1)}-${dois(instante.getDate())}` +
    `T${dois(instante.getHours())}:${dois(instante.getMinutes())}`
  );
}

export async function entrarComoLeiloeiro(page: Page): Promise<void> {
  await entrarPelaInterface(page, LEILOEIRO_DO_SEED, senhaDoSeed());
}

/**
 * Cria um lote "começando agora" pelo fluxo de /painel/lotes/novo (busca → escolhe → dados) e
 * devolve o id lido do link do painel. Exige o leiloeiro logado.
 */
export async function criarLotePelaInterface(
  page: Page,
  opcoes: { carta: string; titulo: string },
): Promise<string> {
  await page.goto('/painel/lotes/novo');
  await page.getByLabel('Buscar carta na Scryfall').fill(opcoes.carta);
  await page.getByRole('button', { name: 'Buscar cartas' }).click();
  await page.getByRole('button', { name: `Escolher ${opcoes.carta}` }).click();

  await page.getByLabel('Título (opcional)').fill(opcoes.titulo);
  await page.getByLabel('Lance inicial (R$)').fill('10,00');
  await page.getByLabel('Incremento mínimo (R$)').fill('1,00');
  await page.getByLabel('Fim', { exact: true }).fill(fimEmHoras(HORAS_DE_DURACAO));
  await page.getByRole('button', { name: 'Criar lote' }).click();

  await expect(page).toHaveURL(/\/painel$/);
  const link = page.getByRole('link', { name: opcoes.titulo, exact: true });
  await expect(link).toBeVisible();
  const href = await link.getAttribute('href');
  const id = href?.split('/').pop();
  if (id === undefined || id === '') throw new Error('e2e: link do lote criado sem id');
  return id;
}

/** Opções de um contexto novo (`beforeAll`) iguais às do projeto: origem, idioma e tema. */
export function opcoesDoContexto(info: TestInfo): BrowserContextOptions {
  const { baseURL, colorScheme } = info.project.use;
  return {
    locale: 'pt-BR',
    colorScheme: colorScheme ?? 'light',
    ...(baseURL === undefined ? {} : { baseURL }),
  };
}

/** Cancela o lote por SQL como dono do banco do worktree (o e2e não tem a rota do leiloeiro aqui). */
export async function cancelarLotePorSql(loteId: string): Promise<void> {
  const conexao = trocarBanco(lerConexaoDoBanco(process.env), nomeDoBancoDoWorktree());
  const cliente = new Client(conexao);
  await cliente.connect();
  try {
    const resultado = await cliente.query(
      "UPDATE lots SET status = 'cancelado', cancelado_em = now() WHERE id = $1",
      [loteId],
    );
    if (resultado.rowCount !== 1) throw new Error('e2e: lote a cancelar não encontrado');
  } finally {
    await cliente.end();
  }
}

/** Espera a imagem do locator carregar de verdade (`naturalWidth > 0`). */
export async function esperarImagemCarregada(imagem: {
  evaluate: <R>(fn: (el: HTMLImageElement) => R) => Promise<R>;
  scrollIntoViewIfNeeded: () => Promise<void>;
}): Promise<void> {
  await imagem.scrollIntoViewIfNeeded();
  await expect
    .poll(() => imagem.evaluate((el) => el.naturalWidth), { message: 'imagem não carregou' })
    .toBeGreaterThan(0);
}
