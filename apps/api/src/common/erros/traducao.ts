// Tradução de qualquer exceção no envelope de erro de specs/001 §Contratos. Usada pelo filtro
// global do Nest e pelos erros que o roteador do Fastify responde antes do Nest (app.ts).
import { HttpException, HttpStatus } from '@nestjs/common';

import type { CorpoDoErro } from '../envelope.js';
import type { CodigoDeErro } from './codigos.js';
import { ErroApi } from './erro-api.js';

/** O que a tradução usa do logger da requisição (filho do Pino, já com o requestId). */
export interface LogDaRequisicao {
  error(objeto: object, mensagem: string): void;
  warn(objeto: object, mensagem: string): void;
}

export interface Traducao {
  readonly status: number;
  readonly corpo: CorpoDoErro;
}

const STATUS_PRIMEIRO_4XX = 400;
const STATUS_PRIMEIRO_5XX = 500;
const STATUS_ULTIMO_5XX = 599;

/** Prefixo dos códigos dos erros do próprio Fastify (FST_ERR_BAD_URL, FST_ERR_CTP_*, ...). */
const PREFIXO_DOS_ERROS_DO_FASTIFY = 'FST_ERR_';

const MENSAGENS: Readonly<Partial<Record<CodigoDeErro, string>>> = {
  DADOS_INVALIDOS: 'Requisição inválida.',
  NAO_AUTENTICADO: 'Autenticação necessária.',
  // Texto fixado em specs/012 §Comportamento (erros de sessão e permissão).
  PAPEL_NAO_PERMITIDO: 'Sua conta não tem permissão para esta ação.',
  NAO_ENCONTRADO: 'Recurso não encontrado.',
  MUITAS_TENTATIVAS: 'Muitas requisições. Aguarde e tente novamente.',
  INDISPONIVEL: 'Serviço temporariamente indisponível. Tente novamente.',
};

/**
 * Código do catálogo para um 4xx do framework (Nest ou Fastify), que não tem código próprio,
 * conforme a tabela de specs/001 §Erros: 403 → PAPEL_NAO_PERMITIDO (ADR 0022), 404 e 405 →
 * NAO_ENCONTRADO, e 400, 409, 413, 414, 415, 422 e qualquer 4xx não listado → DADOS_INVALIDOS.
 */
const CODIGO_POR_STATUS_4XX: Readonly<Record<number, CodigoDeErro>> = {
  [HttpStatus.UNAUTHORIZED]: 'NAO_AUTENTICADO',
  [HttpStatus.FORBIDDEN]: 'PAPEL_NAO_PERMITIDO',
  [HttpStatus.NOT_FOUND]: 'NAO_ENCONTRADO',
  [HttpStatus.METHOD_NOT_ALLOWED]: 'NAO_ENCONTRADO',
  [HttpStatus.TOO_MANY_REQUESTS]: 'MUITAS_TENTATIVAS',
};
const CODIGO_4XX_PADRAO: CodigoDeErro = 'DADOS_INVALIDOS';

function corpoPadrao(codigo: CodigoDeErro): CorpoDoErro {
  return { codigo, mensagem: MENSAGENS[codigo] ?? 'Erro.' };
}

/** 500 INDISPONIVEL com mensagem fixa: o que o cliente recebe de qualquer erro inesperado. */
export const FALHA_INTERNA: Traducao = Object.freeze({
  status: HttpStatus.INTERNAL_SERVER_ERROR,
  corpo: Object.freeze(corpoPadrao('INDISPONIVEL')),
});

function eh4xx(status: number): boolean {
  return status >= STATUS_PRIMEIRO_4XX && status < STATUS_PRIMEIRO_5XX;
}

function eh5xx(status: number): boolean {
  return status >= STATUS_PRIMEIRO_5XX && status <= STATUS_ULTIMO_5XX;
}

/**
 * Erro do próprio Fastify: um Error com `code` FST_ERR_*. A validação de schema do Fastify 5
 * também entra por aqui: ela sempre recebe `code` (FST_ERR_VALIDATION, se o validador não deu
 * outro) além do array `validation`, que sozinho não basta. Outras bibliotecas também usam
 * `statusCode` (um cliente HTTP com o 404 ou 429 do upstream, por exemplo), e esse status não
 * pode chegar ao cliente: elas não entram aqui.
 */
function statusDoErroDoFastify(excecao: unknown): number | undefined {
  if (!(excecao instanceof Error) || !('statusCode' in excecao)) {
    return undefined;
  }
  const doFastify =
    'code' in excecao &&
    typeof excecao.code === 'string' &&
    excecao.code.startsWith(PREFIXO_DOS_ERROS_DO_FASTIFY);
  const { statusCode } = excecao;
  return doFastify && typeof statusCode === 'number' && Number.isInteger(statusCode)
    ? statusCode
    : undefined;
}

/** Identificação segura para log: nome do erro e código do Fastify, nunca a mensagem. */
function identificar(excecao: unknown): { tipo: string; codigoInterno?: string } {
  const tipo = excecao instanceof Error ? excecao.name : typeof excecao;
  const codigoInterno =
    typeof excecao === 'object' && excecao !== null && 'code' in excecao ? excecao.code : undefined;
  return typeof codigoInterno === 'string' ? { tipo, codigoInterno } : { tipo };
}

function traduzirErroApi(excecao: ErroApi, log: LogDaRequisicao): Traducao {
  if (excecao.status >= STATUS_PRIMEIRO_5XX) {
    // `err` leva stack e cause ao log; o serializador `err` tira a PII de drivers.
    log.error({ codigo: excecao.codigo, status: excecao.status, err: excecao }, excecao.message);
  }
  const corpo: CorpoDoErro = excecao.detalhes
    ? { codigo: excecao.codigo, mensagem: excecao.message, detalhes: excecao.detalhes }
    : { codigo: excecao.codigo, mensagem: excecao.message };
  return { status: excecao.status, corpo };
}

/** 4xx do framework: o cliente controla o erro, então o log vai em warn, sem stack nem mensagem. */
function traduzir4xx(status: number, excecao: unknown, log: LogDaRequisicao): Traducao {
  const codigo = CODIGO_POR_STATUS_4XX[status] ?? CODIGO_4XX_PADRAO;
  log.warn({ status, codigo, ...identificar(excecao) }, 'requisição recusada');
  return { status, corpo: corpoPadrao(codigo) };
}

/**
 * Toda exceção vira { status, corpo } do envelope de erro:
 * - ErroApi: o próprio código e status (5xx também vai para o log em error).
 * - HttpException 4xx ou erro 4xx do Fastify: o próprio status, código do catálogo e mensagem
 *   fixa; log em warn.
 * - HttpException 5xx: o próprio status (por exemplo 503), corpo INDISPONIVEL; log em error.
 * - Qualquer outro: 500 INDISPONIVEL sem stack nem mensagem interna; a causa vai só para o log
 *   do servidor, em error, com o requestId.
 */
export function traduzirExcecao(excecao: unknown, log: LogDaRequisicao): Traducao {
  if (excecao instanceof ErroApi) {
    return traduzirErroApi(excecao, log);
  }

  if (excecao instanceof HttpException) {
    const status = excecao.getStatus();
    if (eh4xx(status)) {
      return traduzir4xx(status, excecao, log);
    }
    if (eh5xx(status)) {
      log.error({ status, err: excecao }, 'erro do framework');
      return { status, corpo: corpoPadrao('INDISPONIVEL') };
    }
  }

  const statusDoFastify = statusDoErroDoFastify(excecao);
  if (statusDoFastify !== undefined && eh4xx(statusDoFastify)) {
    return traduzir4xx(statusDoFastify, excecao, log);
  }

  log.error({ err: excecao }, 'erro não tratado');
  return FALHA_INTERNA;
}
