// Scryfall falsa (task 052, specs/005): servidor node:http no loopback que imita /cards/search,
// /cards/{id} e as imagens no formato público da Scryfall, com modos de falha e registro das
// requisições (para medir req/s). Nenhuma dependência além de node:*.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';

import {
  extensaoDaImagem,
  montarCatalogo,
  POR_PAGINA,
  type CartaScryfall,
} from './fixtures-scryfall/cartas.js';
import { GIF_MINIMO, JPEG_MINIMO, jpegGrande, PNG_MINIMO } from './fixtures-scryfall/imagens.js';

export const MODOS_SCRYFALL = [
  'ok',
  '429',
  '5xx',
  'lento',
  'fora',
  'imagem_grande',
  'mime_errado',
  'bloqueada',
] as const;
export type ModoScryfall = (typeof MODOS_SCRYFALL)[number];

export interface RequisicaoRegistrada {
  metodo: string;
  /** Caminho com a query, como chegou (ex.: `/cards/search?q=bolt`). */
  caminho: string;
  /** performance.now() na chegada: monotônico, em ms, com fração. */
  instanteMs: number;
  /** Headers `User-Agent` e `Accept` como chegaram (undefined se ausentes). */
  userAgent: string | undefined;
  accept: string | undefined;
}

export interface OpcoesDoModo {
  /** Depois de `vezes` requisições neste modo, volta sozinho ao `ok`. Sem isso, o modo fica. */
  vezes?: number;
}

export interface OpcoesScryfallFalsa {
  /** 0 (padrão) = porta aleatória. Sempre em 127.0.0.1. */
  porta?: number;
  /** Atraso do modo `lento`. Padrão 5 s (maior que o timeout de 3 s do cliente). */
  atrasoLentoMs?: number;
  /** Habilita `/__controle` (troca de modo e leitura do contador) para o e2e. */
  controle?: boolean;
}

export interface ScryfallFalsa {
  url: string;
  /** Endereço em que o servidor escuta (servidor.address().address). */
  host: string;
  porta: number;
  modo(): ModoScryfall;
  definirModo(modo: ModoScryfall, opcoes?: OpcoesDoModo): void;
  requisicoes(): readonly RequisicaoRegistrada[];
  zerar(): void;
  /**
   * Resolve quando o registro tem pelo menos `n` requisições (espera por evento, sem sleep).
   * Rejeita depois de `limiteMs` (padrão 5 s), para um teste não ficar pendurado.
   */
  aguardarRequisicoes(n: number, limiteMs?: number): Promise<void>;
  fechar(): Promise<void>;
}

const ATRASO_LENTO_PADRAO_MS = 5000;
const RETRY_AFTER_429_S = 30;
const MAX_CORPO_CONTROLE = 4096;
const LIMITE_DE_ESPERA_PADRAO_MS = 5000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function json(res: ServerResponse, status: number, corpo: unknown, extra = {}): void {
  const texto = JSON.stringify(corpo);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(texto),
    ...extra,
  });
  res.end(texto);
}

function erro(
  res: ServerResponse,
  status: number,
  code: string,
  detalhe: string,
  extra = {},
): void {
  json(res, status, { object: 'error', code, status, details: detalhe }, extra);
}

function binario(res: ServerResponse, tipo: string, corpo: Buffer): void {
  res.writeHead(200, { 'content-type': tipo, 'content-length': corpo.length });
  res.end(corpo);
}

function pagina(
  catalogo: CartaScryfall[],
  origem: string,
  q: string,
  numero: number,
): Record<string, unknown> {
  const filtradas = catalogo.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()));
  const inicio = (numero - 1) * POR_PAGINA;
  const data = filtradas.slice(inicio, inicio + POR_PAGINA);
  const temMais = inicio + data.length < filtradas.length;
  return {
    object: 'list',
    total_cards: filtradas.length,
    has_more: temMais,
    ...(temMais
      ? { next_page: `${origem}/cards/search?q=${encodeURIComponent(q)}&page=${numero + 1}` }
      : {}),
    data,
  };
}

function servirBusca(res: ServerResponse, catalogo: CartaScryfall[], origem: string, u: URL): void {
  const q = u.searchParams.get('q');
  const numero = Number(u.searchParams.get('page') ?? '1');
  if (q === null || q === '' || !Number.isInteger(numero) || numero < 1) {
    erro(res, 400, 'bad_request', 'Parâmetro q ou page inválido.');
    return;
  }
  const lista = pagina(catalogo, origem, q, numero);
  if ((lista['total_cards'] as number) === 0) {
    erro(res, 404, 'not_found', 'Sua consulta não retornou nenhuma carta.');
    return;
  }
  json(res, 200, lista);
}

function servirImagem(
  res: ServerResponse,
  catalogo: CartaScryfall[],
  caminho: string,
  modo: ModoScryfall,
): void {
  const m = /^\/imagens\/([^/.]+)\.(jpg|png)$/.exec(caminho);
  const id = m?.[1];
  if (id === undefined || !UUID.test(id) || !catalogo.some((c) => c.id === id)) {
    erro(res, 404, 'not_found', 'Imagem inexistente.');
    return;
  }
  if (modo === 'mime_errado') return binario(res, 'image/gif', GIF_MINIMO);
  if (modo === 'imagem_grande') return binario(res, 'image/jpeg', jpegGrande());
  if (extensaoDaImagem(id) === 'png') return binario(res, 'image/png', PNG_MINIMO);
  binario(res, 'image/jpeg', JPEG_MINIMO);
}

function rotear(
  res: ServerResponse,
  catalogo: CartaScryfall[],
  origem: string,
  u: URL,
  modo: ModoScryfall,
): void {
  if (u.pathname === '/cards/search') return servirBusca(res, catalogo, origem, u);
  if (u.pathname.startsWith('/imagens/')) return servirImagem(res, catalogo, u.pathname, modo);
  const m = /^\/cards\/([^/]+)$/.exec(u.pathname);
  const carta = m?.[1] === undefined ? undefined : catalogo.find((c) => c.id === m[1]);
  if (carta === undefined) return erro(res, 404, 'not_found', 'Carta inexistente.');
  json(res, 200, carta);
}

async function lerCorpo(req: IncomingMessage): Promise<string | null> {
  const partes: Buffer[] = [];
  let total = 0;
  for await (const parte of req) {
    const buf = parte as Buffer;
    total += buf.length;
    if (total > MAX_CORPO_CONTROLE) return null;
    partes.push(buf);
  }
  return Buffer.concat(partes).toString('utf8');
}

export async function iniciarScryfallFalsa(
  opcoes: OpcoesScryfallFalsa = {},
): Promise<ScryfallFalsa> {
  const atrasoLentoMs = opcoes.atrasoLentoMs ?? ATRASO_LENTO_PADRAO_MS;
  let modoAtual: ModoScryfall = 'ok';
  /** Requisições que ainda faltam no modo atual antes de voltar ao `ok` (undefined = sem fim). */
  let restantes: number | undefined;
  let registro: RequisicaoRegistrada[] = [];
  let esperas: { n: number; resolver: () => void }[] = [];
  const timers = new Set<NodeJS.Timeout>();
  const sockets = new Set<Socket>();
  let origem = '';
  let catalogo: CartaScryfall[] = [];

  const acordar = () => {
    const prontas = esperas.filter((e) => registro.length >= e.n);
    esperas = esperas.filter((e) => registro.length < e.n);
    prontas.forEach((e) => e.resolver());
  };

  const controle = async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'GET') {
      return json(res, 200, {
        modo: modoAtual,
        total: registro.length,
        requisicoes: registro,
      });
    }
    const texto = await lerCorpo(req);
    let corpo: { modo?: unknown; zerar?: unknown } | undefined;
    try {
      corpo = texto === null ? undefined : (JSON.parse(texto) as typeof corpo);
    } catch {
      corpo = undefined;
    }
    const modo = corpo?.modo;
    const modoValido = modo === undefined || MODOS_SCRYFALL.includes(modo as ModoScryfall);
    if (req.method !== 'POST' || corpo === undefined || corpo === null || !modoValido) {
      return erro(res, 400, 'bad_request', 'Controle inválido.');
    }
    if (modo !== undefined) {
      modoAtual = modo as ModoScryfall;
      restantes = undefined;
    }
    if (corpo.zerar === true) registro = [];
    json(res, 200, { modo: modoAtual, total: registro.length });
  };

  const tratar = (req: IncomingMessage, res: ServerResponse) => {
    const caminho = req.url ?? '/';
    const u = new URL(caminho, 'http://127.0.0.1');
    if (opcoes.controle === true && u.pathname === '/__controle') {
      controle(req, res).catch(() => res.destroy());
      return;
    }
    registro = [
      ...registro,
      {
        metodo: req.method ?? 'GET',
        caminho,
        instanteMs: performance.now(),
        userAgent: req.headers['user-agent'],
        accept: req.headers.accept,
      },
    ];
    acordar();
    const modo = modoAtual;
    if (restantes !== undefined) {
      restantes -= 1;
      if (restantes <= 0) {
        modoAtual = 'ok';
        restantes = undefined;
      }
    }
    if (modo === 'fora') return void req.socket.destroy();
    if (modo === '429' || modo === 'bloqueada') {
      if (modo === '429') {
        modoAtual = 'ok';
        restantes = undefined;
      }
      return erro(res, 429, 'too_many_requests', 'Limite excedido.', {
        'retry-after': String(RETRY_AFTER_429_S),
      });
    }
    if (modo === '5xx') return erro(res, 503, 'unavailable', 'Indisponível.');
    if (modo === 'lento') {
      const t = setTimeout(() => {
        timers.delete(t);
        rotear(res, catalogo, origem, u, 'ok');
      }, atrasoLentoMs);
      timers.add(t);
      return;
    }
    rotear(res, catalogo, origem, u, modo);
  };

  const servidor: Server = createServer(tratar);
  servidor.on('connection', (s) => {
    sockets.add(s);
    s.once('close', () => sockets.delete(s));
  });
  await new Promise<void>((resolver, rejeitar) => {
    servidor.once('error', rejeitar);
    servidor.listen(opcoes.porta ?? 0, '127.0.0.1', resolver);
  });
  const endereco = servidor.address();
  if (endereco === null || typeof endereco === 'string') {
    throw new Error('scryfall-falsa: endereço inesperado');
  }
  origem = `http://127.0.0.1:${endereco.port}`;
  catalogo = montarCatalogo(origem);

  return {
    url: origem,
    host: endereco.address,
    porta: endereco.port,
    modo: () => modoAtual,
    definirModo: (modo, opcoesDoModo = {}) => {
      modoAtual = modo;
      restantes = opcoesDoModo.vezes;
    },
    requisicoes: () => [...registro],
    zerar: () => {
      registro = [];
    },
    aguardarRequisicoes: (n, limiteMs = LIMITE_DE_ESPERA_PADRAO_MS) => {
      if (registro.length >= n) return Promise.resolve();
      return new Promise<void>((resolver, rejeitar) => {
        const t = setTimeout(() => {
          esperas = esperas.filter((e) => e !== espera);
          rejeitar(new Error(`scryfall-falsa: ${registro.length} de ${n} requisições`));
        }, limiteMs);
        const espera = {
          n,
          resolver: () => {
            clearTimeout(t);
            resolver();
          },
        };
        esperas.push(espera);
      });
    },
    fechar: async () => {
      timers.forEach(clearTimeout);
      timers.clear();
      sockets.forEach((s) => s.destroy());
      await new Promise<void>((resolver) => servidor.close(() => resolver()));
    },
  };
}
