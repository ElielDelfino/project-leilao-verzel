import { ErroDaApi } from './erro';

// Cliente HTTP da SPA (specs/012, specs/003). Cookies same-origin; CSRF por double-submit; um único
// refresh por vez quando o access token expira.

type Metodo = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface OpcoesDaRequisicao {
  corpo?: unknown;
  cabecalhos?: Record<string, string>;
  consulta?: Record<string, string | number>;
}

const COOKIE_CSRF = 'csrf_token';
const HEADER_CSRF = 'X-CSRF-Token';
const ROTA_CSRF = '/api/auth/csrf';
const ROTA_REFRESH = '/api/auth/refresh';
const METODOS_COM_CSRF: ReadonlySet<Metodo> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function lerCookieCsrf(): string | null {
  const par = document.cookie.split('; ').find((c) => c.startsWith(`${COOKIE_CSRF}=`));
  return par ? decodeURIComponent(par.slice(COOKIE_CSRF.length + 1)) || null : null;
}

// ---------------------------------------------------------------- sessão expirada

export type MotivoDaSessaoPerdida = 'SESSAO_EXPIRADA' | 'NAO_AUTENTICADO';
type OuvinteDeSessao = (motivo: MotivoDaSessaoPerdida) => void;
const ouvintesDeSessao = new Set<OuvinteDeSessao>();

/**
 * Avisa quando a sessão se perde durante o uso: o refresh falhou (`SESSAO_EXPIRADA`) ou a
 * repetição depois de um refresh bem-sucedido voltou 401 (`NAO_AUTENTICADO`). Devolve a função que cancela a inscrição. */
export function ouvirSessaoExpirada(ouvinte: OuvinteDeSessao): () => void {
  ouvintesDeSessao.add(ouvinte);
  return () => ouvintesDeSessao.delete(ouvinte);
}

// ---------------------------------------------------------------- resposta

function segundosDoRetryAfter(resposta: Response): number | undefined {
  const valor = Number(resposta.headers.get('Retry-After'));
  return Number.isInteger(valor) && valor > 0 ? valor : undefined;
}

function ehRecord(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function erroDeResposta(resposta: Response, corpo: unknown): ErroDaApi {
  const erro = ehRecord(corpo) && ehRecord(corpo['erro']) ? corpo['erro'] : null;
  if (erro && typeof erro['codigo'] === 'string') {
    return new ErroDaApi({
      status: resposta.status,
      // O contrato fixa os códigos; um código novo ainda cai no texto genérico do mapa.
      codigo: erro['codigo'] as ErroDaApi['codigo'],
      detalhes: ehRecord(erro['detalhes']) ? erro['detalhes'] : undefined,
      retryAfterSegundos: segundosDoRetryAfter(resposta),
    });
  }
  return new ErroDaApi({ status: resposta.status, codigo: 'INDISPONIVEL' });
}

async function lerCorpo(resposta: Response): Promise<unknown> {
  const texto = await resposta.text();
  if (texto === '') return undefined;
  try {
    return JSON.parse(texto) as unknown;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------- CSRF

let csrfEmAndamento: Promise<void> | null = null;

async function garantirCsrf(): Promise<string> {
  const existente = lerCookieCsrf();
  if (existente) return existente;

  csrfEmAndamento ??= enviar('GET', ROTA_CSRF, {})
    .then(() => undefined)
    .finally(() => {
      csrfEmAndamento = null;
    });
  await csrfEmAndamento;

  const emitido = lerCookieCsrf();
  if (!emitido) throw new ErroDaApi({ status: 403, codigo: 'CSRF_INVALIDO' });
  return emitido;
}

// ---------------------------------------------------------------- envio

function montarUrl(caminho: string, consulta?: Record<string, string | number>): string {
  const url = new URL(caminho, globalThis.location.origin);
  for (const [chave, valor] of Object.entries(consulta ?? {})) {
    url.searchParams.set(chave, String(valor));
  }
  return url.toString();
}

async function enviar(
  metodo: Metodo,
  caminho: string,
  opcoes: OpcoesDaRequisicao,
): Promise<unknown> {
  const cabecalhos = new Headers(opcoes.cabecalhos);
  cabecalhos.set('Accept', 'application/json');
  if (METODOS_COM_CSRF.has(metodo) && caminho !== ROTA_CSRF) {
    cabecalhos.set(HEADER_CSRF, await garantirCsrf());
  }
  let corpo: string | undefined;
  if (opcoes.corpo !== undefined) {
    cabecalhos.set('Content-Type', 'application/json');
    corpo = JSON.stringify(opcoes.corpo);
  }

  let resposta: Response;
  try {
    resposta = await globalThis.fetch(montarUrl(caminho, opcoes.consulta), {
      method: metodo,
      headers: cabecalhos,
      credentials: 'same-origin',
      ...(corpo === undefined ? {} : { body: corpo }),
    });
  } catch {
    throw new ErroDaApi({ status: 0, codigo: 'INDISPONIVEL' });
  }

  const dados = await lerCorpo(resposta);
  if (!resposta.ok) throw erroDeResposta(resposta, dados);
  if (resposta.status !== 204 && !ehRecord(dados)) {
    throw new ErroDaApi({ status: resposta.status, codigo: 'INDISPONIVEL' });
  }
  return dados;
}

// ---------------------------------------------------------------- refresh

let refreshEmAndamento: Promise<void> | null = null;

/** Um único POST /api/auth/refresh por vez; quem chega durante ele espera o mesmo resultado. */
function renovarSessao(): Promise<void> {
  refreshEmAndamento ??= enviar('POST', ROTA_REFRESH, {})
    .then(() => undefined)
    .catch((erro: unknown) => {
      if (erro instanceof ErroDaApi && erro.status === 401) {
        ouvintesDeSessao.forEach((ouvinte) => ouvinte('SESSAO_EXPIRADA'));
        throw new ErroDaApi({ status: 401, codigo: 'SESSAO_EXPIRADA' });
      }
      throw erro;
    })
    .finally(() => {
      refreshEmAndamento = null;
    });
  return refreshEmAndamento;
}

/**
 * Faz a requisição e devolve o corpo já em JSON (envelope de sucesso) ou `undefined` no 204.
 * Em 401 `NAO_AUTENTICADO` renova a sessão e repete uma vez. O tipo do corpo é responsabilidade
 * de quem chama (as funções de `api/` usam os tipos de `@leilao/contracts`).
 */
export async function requisitar<T = unknown>(
  metodo: Metodo,
  caminho: string,
  opcoes: OpcoesDaRequisicao = {},
): Promise<T> {
  try {
    return (await enviar(metodo, caminho, opcoes)) as T;
  } catch (erro) {
    const renovavel =
      erro instanceof ErroDaApi &&
      erro.status === 401 &&
      erro.codigo === 'NAO_AUTENTICADO' &&
      caminho !== ROTA_REFRESH;
    if (!renovavel) throw erro;
  }
  await renovarSessao();
  try {
    return (await enviar(metodo, caminho, opcoes)) as T;
  } catch (erro) {
    if (erro instanceof ErroDaApi && erro.status === 401 && erro.codigo === 'NAO_AUTENTICADO') {
      ouvintesDeSessao.forEach((ouvinte) => ouvinte('NAO_AUTENTICADO'));
    }
    throw erro;
  }
}
