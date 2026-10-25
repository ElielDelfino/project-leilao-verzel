// Passos da sala ao vivo para o e2e da saída da F3 (task 091): navegadores com conta e saldo,
// lance pela interface, medida de tempo no relógio da página, fim do lote por SQL e limpeza do rate
// limit restrita às chaves que estes testes criam.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

import {
  expect,
  type Browser,
  type BrowserContext,
  type Page,
  type TestInfo,
  type WebSocketRoute,
} from '@playwright/test';
import type { Client as ClientePg } from 'pg';

import { lerConexaoDoBanco, trocarBanco } from '../../apps/api/src/db/conexao.js';
import { nomeDoBancoDoWorktree } from '../../apps/api/test/setup/banco-de-teste.js';
import { entrarComoLeiloeiro, opcoesDoContexto } from './lotes.js';
import { cadastrarLicitante, emailNovo, entrarPelaInterface, senhaDoSeed } from './sessao.js';

// `pg` e `redis` são dependências da API, não da raiz: resolvem a partir do pacote dela.
const daApi = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const { Client } = daApi('pg') as { Client: typeof ClientePg };

interface ClienteRedis {
  connect(): Promise<unknown>;
  scanIterator(opcoes: { MATCH: string; COUNT: number }): AsyncIterable<string[]>;
  del(chaves: string[]): Promise<unknown>;
  destroy(): void;
}
const { createClient } = daApi('redis') as {
  createClient(opcoes: { socket: { host: string; port: number }; password: string }): ClienteRedis;
};

export const BRUNO_DO_SEED = 'bruno@demo.local';

/** Um navegador isolado (cookies próprios) com a página que o teste usa. */
export interface Navegador {
  readonly contexto: BrowserContext;
  readonly pagina: Page;
}

const LOTE_DO_SCAN = 200;
const HEX_DO_EMAIL_NA_CHAVE = 16;
/**
 * IPs que a API vê nas requisições do e2e: o navegador fala com o proxy do Vite e este com a API,
 * tudo em loopback (a API não usa `trustProxy`, então o IP é o do socket). Só os contadores de
 * cadastro desses IPs são apagados; os de qualquer outro IP (outras execuções) ficam.
 */
const IPS_LOOPBACK_DO_E2E = ['127.0.0.1', '::1', '::ffff:127.0.0.1'] as const;
const CHAVES_DE_CADASTRO_DO_E2E: ReadonlySet<string> = new Set(
  IPS_LOOPBACK_DO_E2E.map((ip) => `ratelimit:cadastro:${ip}`),
);

function variavel(nome: string): string {
  const valor = process.env[nome];
  if (valor === undefined || valor === '') {
    throw new Error(`e2e: variável ${nome} ausente`);
  }
  return valor;
}

async function comRedis<T>(operacao: (cliente: ClienteRedis) => Promise<T>): Promise<T> {
  const cliente = createClient({
    socket: { host: variavel('REDIS_HOST'), port: Number(variavel('REDIS_PORT')) },
    password: variavel('REDIS_PASSWORD'),
  });
  await cliente.connect();
  try {
    return await operacao(cliente);
  } finally {
    cliente.destroy();
  }
}

async function apagarPorPadrao(
  cliente: ClienteRedis,
  padrao: string,
  aceita: (chave: string) => boolean,
): Promise<void> {
  for await (const chaves of cliente.scanIterator({ MATCH: padrao, COUNT: LOTE_DO_SCAN })) {
    const alvo = chaves.filter(aceita);
    if (alvo.length > 0) await cliente.del(alvo);
  }
}

/**
 * Zera só o que estes testes criam: o contador de login das contas informadas
 * (`ratelimit:login:{ip}:{h}`, h = 16 primeiros hex do SHA-256 do e-mail em minúsculas) e, se
 * pedido, o de cadastro dos IPs loopback do e2e (`ratelimit:cadastro:{ip}`). Nunca apaga o resto
 * de `ratelimit:*` (Redis de dev compartilhado).
 */
export async function limparRateLimitDasContas(
  emails: readonly string[],
  opcoes: { cadastro?: boolean } = {},
): Promise<void> {
  const sufixos = emails.map(
    (email) =>
      `:${createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, HEX_DO_EMAIL_NA_CHAVE)}`,
  );
  await comRedis(async (cliente) => {
    await apagarPorPadrao(cliente, 'ratelimit:login:*', (chave) =>
      sufixos.some((sufixo) => chave.endsWith(sufixo)),
    );
    if (opcoes.cadastro === true) {
      await apagarPorPadrao(cliente, 'ratelimit:cadastro:*', (chave) =>
        CHAVES_DE_CADASTRO_DO_E2E.has(chave),
      );
    }
  });
}

export async function abrirNavegador(browser: Browser, info: TestInfo): Promise<Navegador> {
  const contexto = await browser.newContext(opcoesDoContexto(info));
  return { contexto, pagina: await contexto.newPage() };
}

/** Deposita pelo formulário da carteira e espera a confirmação. Exige licitante logado. */
export async function depositarPelaInterface(page: Page, valor: string): Promise<void> {
  await page.goto('/carteira');
  await page.getByLabel('Valor do depósito (R$)').fill(valor);
  await page.getByRole('button', { name: 'Depositar' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Depósito de' })).toBeVisible();
}

/**
 * Abre um navegador e roda o preparo; se o preparo falhar, fecha o contexto antes de repassar o
 * erro (senão o chamador, que ainda não recebeu o navegador, não teria como fechá-lo).
 */
async function abrirEPreparar(
  browser: Browser,
  info: TestInfo,
  preparar: (navegador: Navegador) => Promise<void>,
): Promise<Navegador> {
  const navegador = await abrirNavegador(browser, info);
  try {
    await preparar(navegador);
  } catch (erro) {
    // O erro do preparo é o que importa: uma falha ao fechar não pode escondê-lo.
    await navegador.contexto.close().catch(() => undefined);
    throw erro;
  }
  return navegador;
}

/**
 * Fecha todos os contextos (`afterAll`). Usa `allSettled`: um contexto que falha ao fechar não
 * impede o fechamento dos outros; as falhas são reportadas juntas no fim.
 */
export async function fecharContextos(contextos: readonly BrowserContext[]): Promise<void> {
  const resultados = await Promise.allSettled(contextos.map((contexto) => contexto.close()));
  const falhas = resultados.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (falhas.length > 0) {
    throw new AggregateError(
      falhas.map((f) => f.reason as unknown),
      'e2e: falha ao fechar contextos de navegador',
    );
  }
}

export async function prepararLeiloeiro(browser: Browser, info: TestInfo): Promise<Navegador> {
  return abrirEPreparar(browser, info, (navegador) => entrarComoLeiloeiro(navegador.pagina));
}

/** Conta do seed (ana, bruno) logada e com saldo depositado pela interface. */
export async function prepararLicitanteDoSeed(
  browser: Browser,
  info: TestInfo,
  email: string,
  depositoEmReais: string,
): Promise<Navegador> {
  return abrirEPreparar(browser, info, async (navegador) => {
    await entrarPelaInterface(navegador.pagina, email, senhaDoSeed());
    await depositarPelaInterface(navegador.pagina, depositoEmReais);
  });
}

/** Licitante recém-cadastrado, com saldo exato (para o caso de saldo insuficiente). */
export async function prepararLicitanteNovo(
  browser: Browser,
  info: TestInfo,
  depositoEmReais: string,
): Promise<Navegador> {
  await limparRateLimitDasContas([], { cadastro: true });
  return abrirEPreparar(browser, info, async (navegador) => {
    await cadastrarLicitante(navegador.pagina, emailNovo());
    await depositarPelaInterface(navegador.pagina, depositoEmReais);
  });
}

/**
 * Regex de um texto da tela: escapa os metacaracteres e deixa cada espaço casar com qualquer
 * espaço (o formatador de moeda usa espaço não separável entre "R$" e o valor).
 */
export function texto(modelo: string): RegExp {
  const escapado = modelo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(escapado.replace(/ /g, '\\s'));
}

/** Abre a sala e espera o painel ao vivo (o estado chegou pelo ack do `entrar_lote`). */
export async function abrirSala(page: Page, loteId: string): Promise<void> {
  await page.goto(`/lotes/${loteId}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByText(/^Lance inicial:/)).toBeVisible();
}

/** Abre a sala de um licitante e espera o formulário utilizável (socket conectado). */
export async function abrirSalaComoLicitante(page: Page, loteId: string): Promise<void> {
  await abrirSala(page, loteId);
  await expect(page.getByRole('form', { name: 'Dar lance' })).toBeVisible();
  await expect(page.getByLabel('Valor do lance (R$)')).toBeEnabled();
}

export async function esperarLanceMinimo(page: Page, valor: string): Promise<void> {
  await expect(page.getByText(texto(`Lance mínimo: R$ ${valor}`))).toBeVisible();
}

/** Preenche o valor (em reais, "11,00") e envia pelo botão "Dar lance". */
export async function darLancePelaInterface(page: Page, valor: string): Promise<void> {
  await page.getByLabel('Valor do lance (R$)').fill(valor);
  await page.getByRole('button', { name: 'Dar lance', exact: true }).click();
}

export async function esperarLanceRegistrado(page: Page, valor: string): Promise<void> {
  await expect(
    page.getByRole('status').filter({ hasText: texto(`Lance de R$ ${valor} registrado.`) }),
  ).toBeVisible();
}

/** Recusa mostrada no formulário (o `role="alert"` do campo, não o anúncio oculto da sala). */
export function recusaDoLance(page: Page, mensagem: string) {
  return page.locator('#lance-erro').filter({ hasText: texto(mensagem) });
}

/** Indicador de posição da sala ("Você está ganhando…", "Você foi superado…"). */
export function indicadorDePosicao(page: Page, inicio: string) {
  return page.locator('p').filter({ hasText: texto(inicio) });
}

/** Segundos que a contagem da sala mostra; -1 se ela não mostra uma contagem. */
export async function segundosRestantes(page: Page): Promise<number> {
  const conteudo = (await page.getByRole('timer').textContent()) ?? '';
  const partes = /(\d{2}):(\d{2}):(\d{2})/.exec(conteudo);
  if (partes === null) return -1;
  const [, horas, minutos, segundos] = partes;
  return Number(horas) * 3600 + Number(minutos) * 60 + Number(segundos);
}

/** Queda e volta da conexão em tempo real de UMA página (o resto do contexto não é afetado). */
export interface SocketControlavel {
  /** Fecha o socket aberto e recusa as novas conexões (o cliente fica em "Reconectando…"). */
  derrubar(): void;
  /** Volta a aceitar conexões: a próxima tentativa de reconexão do cliente passa. */
  restaurar(): void;
}

/**
 * O `setOffline` do contexto não derruba um WebSocket já aberto, então o proxy fica no socket: ele
 * repassa tudo até `derrubar()`, que fecha o par navegador↔servidor e fecha na hora cada nova
 * tentativa. Instalar ANTES do `goto` da sala; o cliente só usa `websocket` (namespace /leilao).
 */
export async function controlarSocketDaPagina(page: Page): Promise<SocketControlavel> {
  let caido = false;
  const ativos = new Set<{ pagina: WebSocketRoute; servidor: WebSocketRoute }>();
  await page.routeWebSocket(/\/socket\.io\//, (pagina) => {
    if (caido) {
      void pagina.close();
      return;
    }
    const servidor = pagina.connectToServer();
    const par = { pagina, servidor };
    ativos.add(par);
    pagina.onMessage((mensagem) => {
      servidor.send(mensagem);
    });
    servidor.onMessage((mensagem) => {
      pagina.send(mensagem);
    });
    pagina.onClose(() => {
      ativos.delete(par);
    });
  });
  return {
    derrubar: () => {
      caido = true;
      for (const par of ativos) {
        void par.servidor.close();
        void par.pagina.close();
      }
      ativos.clear();
    },
    restaurar: () => {
      caido = false;
    },
  };
}

type NomeDaMarca = 'superadoEm' | 'cliqueEm';

/**
 * Medida no relógio do navegador (não do servidor): a página registra, em
 * `performance.timeOrigin + performance.now()` (época em ms, com precisão de sub-milissegundo), o
 * instante em que "Você foi superado" entra no DOM. As duas páginas são do mesmo navegador, então
 * os dois lados da medida usam a mesma base. Chamar depois do `goto` da sala.
 */
export async function observarSuperado(page: Page): Promise<void> {
  await page.evaluate(() => {
    const janela = window as unknown as Record<string, number | undefined>;
    const marcar = (): void => {
      const conteudo = document.body.textContent ?? '';
      if (janela['__superadoEm'] === undefined && conteudo.includes('Você foi superado')) {
        janela['__superadoEm'] = performance.timeOrigin + performance.now();
      }
    };
    new MutationObserver(marcar).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    marcar();
  });
}

/**
 * Registra o instante do último clique da página (fase de captura, antes do React), na mesma base
 * de `observarSuperado` (`performance.timeOrigin + performance.now()`).
 */
export async function observarCliques(page: Page): Promise<void> {
  await page.evaluate(() => {
    const janela = window as unknown as Record<string, number | undefined>;
    document.addEventListener(
      'click',
      () => {
        janela['__cliqueEm'] = performance.timeOrigin + performance.now();
      },
      { capture: true },
    );
  });
}

export async function lerMarca(page: Page, nome: NomeDaMarca): Promise<number | undefined> {
  return page.evaluate(
    (chave) => (window as unknown as Record<string, number | undefined>)[chave],
    `__${nome}`,
  );
}

/**
 * Deixa o lote com `segundos` para o fim (o dono do banco pode mudar o que a API não muda). O
 * início vai para 10 min atrás: `fim_original_em` precisa acompanhar o fim (`fim_em ≥
 * fim_original_em`) e a duração original tem mínimo de 5 min. Fazer ANTES de abrir a sala.
 */
export async function aproximarFimDoLotePorSql(loteId: string, segundos: number): Promise<void> {
  const conexao = trocarBanco(lerConexaoDoBanco(process.env), nomeDoBancoDoWorktree());
  const cliente = new Client(conexao);
  await cliente.connect();
  try {
    const resultado = await cliente.query(
      `UPDATE lots
          SET inicio_em = now() - interval '10 minutes',
              fim_original_em = now() + make_interval(secs => $2),
              fim_em = now() + make_interval(secs => $2)
        WHERE id = $1`,
      [loteId, segundos],
    );
    if (resultado.rowCount !== 1) throw new Error('e2e: lote a encurtar não encontrado');
  } finally {
    await cliente.end();
  }
}
