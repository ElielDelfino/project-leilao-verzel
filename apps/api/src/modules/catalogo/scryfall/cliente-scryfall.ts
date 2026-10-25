// Cliente da Scryfall (specs/005 §Busca e §Cliente HTTP, bucket e circuito). Ordem das camadas,
// parando na primeira que responde: cache → circuito → ficha do bucket → upstream. Com o Redis fora,
// falha fechada: 503 CATALOGO_INDISPONIVEL sem chamar a Scryfall (sem bucket, o limite não vale).
import { createHash } from 'node:crypto';

import type { ConfigDaScryfall } from '../../../config/env.js';
import { type ComandosDoCatalogoNoRedis, ErroDoRedis } from '../../../redis/cliente.js';
import { aguardarFicha } from './bucket.js';
import { type Circuito, criarCircuito } from './circuito.js';
import {
  campoInvalido,
  catalogoIndisponivel,
  catalogoOcupado,
  segundosParaTentar,
} from './erros.js';
import {
  type CartaScryfall,
  jsonOuUndefined,
  lerCarta,
  lerListaDaBusca,
  lerPaginaGuardada,
  type PaginaDaBusca,
  UUID,
} from './projecao.js';

export type { CartaDaBusca, CartaScryfall, PaginaDaBusca } from './projecao.js';

/** Interface interna do módulo catalogo para a Scryfall (tarefa 054). */
export interface ClienteScryfall {
  /** Página da Scryfall (até 175 cartas) já projetada; 404 dela vira `{total: 0, cartas: []}`. */
  buscar(q: string, paginaScryfall: number): Promise<PaginaDaBusca>;
  /** JSON de `/cards/{id}`; `null` se a Scryfall responder 404. */
  obterCarta(scryfallId: string): Promise<CartaScryfall | null>;
}

export type RedisDoCatalogo = ComandosDoCatalogoNoRedis;

/** Tempos do cliente; os padrões são os de specs/005. Os testes encurtam alguns. */
export interface TemposDoCliente {
  readonly timeoutMs: number;
  readonly backoffMs: number;
  readonly circuitoMs: number;
  readonly esperaMaximaDaFichaMs: number;
}

export interface OpcoesDoClienteScryfall {
  readonly redis: RedisDoCatalogo;
  readonly config: ConfigDaScryfall;
  /** Prefixo das chaves Redis. Padrão `scryfall:` (cache/redis/README.md). */
  readonly prefixo?: string;
  readonly tempos?: Partial<TemposDoCliente>;
}

const TEMPOS_PADRAO: TemposDoCliente = {
  timeoutMs: 3_000,
  backoffMs: 200,
  circuitoMs: 30_000,
  esperaMaximaDaFichaMs: 1_000,
};
const PREFIXO_PADRAO = 'scryfall:';
const CACHE_MS = 24 * 60 * 60 * 1000;
const FALHAS_PARA_ABRIR = 5;
const TENTATIVAS = 2;
/** Intervalo entre fichas: 2 req/s em search, 10 req/s no resto (specs/005 RNF-02). */
const INTERVALO_DO_BUCKET_MS = { search: 500, default: 100 } as const;
type Bucket = keyof typeof INTERVALO_DO_BUCKET_MS;

const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_ERRO_DO_SERVIDOR = 500;

interface RespostaDoUpstream {
  readonly status: number;
  readonly corpo: unknown;
}

/** Falha que conta para o circuito e permite retry: timeout, erro de rede ou 5xx. */
const FALHA_TRANSITORIA = Symbol('falha transitória');

async function esperar(ms: number): Promise<void> {
  await new Promise((resolver) => setTimeout(resolver, ms));
}

export function criarClienteScryfall(opcoes: OpcoesDoClienteScryfall): ClienteScryfall {
  const { redis, config } = opcoes;
  const prefixo = opcoes.prefixo ?? PREFIXO_PADRAO;
  const tempos: TemposDoCliente = { ...TEMPOS_PADRAO, ...opcoes.tempos };
  const circuito: Circuito = criarCircuito(
    redis,
    `${prefixo}circuito`,
    tempos.circuitoMs,
    FALHAS_PARA_ABRIR,
  );

  /** Uma tentativa: o corpo também é lido dentro do timeout. Nunca propaga o erro do fetch. */
  async function tentar(caminho: string): Promise<RespostaDoUpstream | typeof FALHA_TRANSITORIA> {
    try {
      const resposta = await fetch(`${config.baseUrl}${caminho}`, {
        headers: { 'User-Agent': config.userAgent, Accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(tempos.timeoutMs),
      });
      if (resposta.status >= HTTP_ERRO_DO_SERVIDOR) {
        await resposta.body?.cancel();
        return FALHA_TRANSITORIA;
      }
      return { status: resposta.status, corpo: jsonOuUndefined(await resposta.text()) };
    } catch {
      // Timeout, conexão recusada ou derrubada: a mensagem do fetch leva a URL; não segue adiante.
      return FALHA_TRANSITORIA;
    }
  }

  /** Ficha + chamada, com 1 retry só para falha transitória. 429 abre o circuito sem retry. */
  async function requisitar(caminho: string, bucket: Bucket): Promise<RespostaDoUpstream> {
    for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa += 1) {
      if (tentativa > 1) await esperar(tempos.backoffMs);
      const comFicha = await aguardarFicha(
        redis,
        `${prefixo}bucket:${bucket}`,
        INTERVALO_DO_BUCKET_MS[bucket],
        tempos.esperaMaximaDaFichaMs,
      );
      if (!comFicha) throw catalogoOcupado();
      const resultado = await tentar(caminho);
      if (resultado === FALHA_TRANSITORIA) continue;
      if (resultado.status === HTTP_TOO_MANY_REQUESTS) {
        await circuito.abrir();
        throw catalogoIndisponivel(segundosParaTentar(tempos.circuitoMs));
      }
      circuito.registrarSucesso();
      return resultado;
    }
    const abriu = await circuito.registrarFalha();
    throw catalogoIndisponivel(abriu ? segundosParaTentar(tempos.circuitoMs) : undefined);
  }

  /** Circuito aberto → 503 com o TTL restante; nenhuma ficha é consumida. */
  async function exigirCircuitoFechado(): Promise<void> {
    const restante = await circuito.restanteMs();
    if (restante > 0) throw catalogoIndisponivel(segundosParaTentar(restante));
  }

  async function buscar(q: string, paginaScryfall: number): Promise<PaginaDaBusca> {
    const chave = `${prefixo}busca:${createHash('sha1').update(q).digest('hex')}:${paginaScryfall}`;
    const guardado = await redis.obter(chave);
    const emCache = guardado === null ? undefined : lerPaginaGuardada(guardado);
    if (emCache !== undefined) return emCache;

    await exigirCircuitoFechado();
    const parametros = new URLSearchParams({
      q,
      page: String(paginaScryfall),
      unique: 'cards',
      order: 'name',
    });
    const resposta = await requisitar(`/cards/search?${parametros.toString()}`, 'search');
    const pagina = paginaDaResposta(resposta);
    await redis.gravarComTtl(chave, JSON.stringify(pagina), CACHE_MS);
    return pagina;
  }

  async function obterCarta(scryfallId: string): Promise<CartaScryfall | null> {
    if (!UUID.test(scryfallId)) throw campoInvalido('scryfallId');
    const id = scryfallId.toLowerCase();
    const chave = `${prefixo}carta:${id}`;
    const guardado = await redis.obter(chave);
    const emCache = guardado === null ? undefined : lerCarta(jsonOuUndefined(guardado));
    if (emCache !== undefined) return emCache;

    await exigirCircuitoFechado();
    const resposta = await requisitar(`/cards/${id}`, 'default');
    if (resposta.status === 404) return null;
    const carta = resposta.status === 200 ? lerCarta(resposta.corpo) : undefined;
    if (carta === undefined) throw catalogoIndisponivel();
    await redis.gravarComTtl(chave, JSON.stringify(carta), CACHE_MS);
    return carta;
  }

  return {
    buscar: (q, paginaScryfall) => comRedisFechado(() => buscar(q, paginaScryfall)),
    obterCarta: (scryfallId) => comRedisFechado(() => obterCarta(scryfallId)),
  };
}

/** 200 → página projetada; 404 → vazia; 400 → 422 no `q`; o resto → 503. */
function paginaDaResposta(resposta: RespostaDoUpstream): PaginaDaBusca {
  if (resposta.status === 404) return { total: 0, cartas: [] };
  if (resposta.status === 400) throw campoInvalido('q');
  const pagina = resposta.status === 200 ? lerListaDaBusca(resposta.corpo) : undefined;
  if (pagina === undefined) throw catalogoIndisponivel();
  return pagina;
}

/** Redis fora em qualquer etapa → 503 CATALOGO_INDISPONIVEL (specs/005 §Busca). */
async function comRedisFechado<T>(operacao: () => Promise<T>): Promise<T> {
  try {
    return await operacao();
  } catch (erro: unknown) {
    if (erro instanceof ErroDoRedis) throw catalogoIndisponivel();
    throw erro;
  }
}
