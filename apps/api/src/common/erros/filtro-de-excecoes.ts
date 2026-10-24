import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';

import { type CorpoDoErro, falha } from '../envelope.js';
import type { CodigoDeErro } from './codigos.js';
import { ErroApi } from './erro-api.js';

/** O que o filtro usa da requisição do Fastify: o logger filho, já com o requestId. */
interface RequisicaoComLog {
  readonly log: {
    error(objeto: object, mensagem: string): void;
    warn(objeto: object, mensagem: string): void;
  };
}

interface Traducao {
  readonly status: number;
  readonly corpo: CorpoDoErro;
}

const STATUS_PRIMEIRO_4XX = 400;
const STATUS_PRIMEIRO_5XX = 500;

const MENSAGENS: Readonly<Partial<Record<CodigoDeErro, string>>> = {
  DADOS_INVALIDOS: 'Requisição inválida.',
  NAO_AUTENTICADO: 'Autenticação necessária.',
  NAO_ENCONTRADO: 'Recurso não encontrado.',
  MUITAS_TENTATIVAS: 'Muitas requisições. Aguarde e tente novamente.',
  INDISPONIVEL: 'Serviço temporariamente indisponível. Tente novamente.',
};

/**
 * Código do catálogo para um 4xx vindo do framework (Nest ou Fastify), que não tem código
 * próprio. Provisório até a tarefa 018 (mapeamento definitivo): 403 usa NAO_AUTENTICADO e os
 * 4xx sem equivalente usam DADOS_INVALIDOS, os mais próximos do catálogo atual.
 */
const CODIGO_POR_STATUS_4XX: Readonly<Record<number, CodigoDeErro>> = {
  [HttpStatus.UNAUTHORIZED]: 'NAO_AUTENTICADO',
  [HttpStatus.FORBIDDEN]: 'NAO_AUTENTICADO',
  [HttpStatus.NOT_FOUND]: 'NAO_ENCONTRADO',
  [HttpStatus.METHOD_NOT_ALLOWED]: 'NAO_ENCONTRADO',
  [HttpStatus.TOO_MANY_REQUESTS]: 'MUITAS_TENTATIVAS',
};
const CODIGO_4XX_PADRAO: CodigoDeErro = 'DADOS_INVALIDOS';

function corpoPadrao(codigo: CodigoDeErro): CorpoDoErro {
  return { codigo, mensagem: MENSAGENS[codigo] ?? 'Erro.' };
}

/** Status de um erro do framework: HttpException do Nest ou erro do Fastify com `statusCode`. */
function statusDoFramework(excecao: unknown): number | undefined {
  if (excecao instanceof HttpException) {
    return excecao.getStatus();
  }
  if (typeof excecao === 'object' && excecao !== null && 'statusCode' in excecao) {
    const { statusCode } = excecao;
    return typeof statusCode === 'number' && Number.isInteger(statusCode) ? statusCode : undefined;
  }
  return undefined;
}

/** Identificação segura para log: nome do erro e código do Fastify, nunca a mensagem. */
function identificar(excecao: unknown): { tipo: string; codigoInterno?: string } {
  const tipo = excecao instanceof Error ? excecao.name : typeof excecao;
  const codigoInterno =
    typeof excecao === 'object' && excecao !== null && 'code' in excecao ? excecao.code : undefined;
  return typeof codigoInterno === 'string' ? { tipo, codigoInterno } : { tipo };
}

/**
 * Filtro global: toda exceção vira o envelope de erro de specs/001 §Contratos.
 * - ErroApi: o próprio código e status (5xx também vai para o log em error).
 * - Erro 4xx do framework: o próprio status, código do catálogo e mensagem fixa; log em warn,
 *   sem stack nem mensagem da exceção (o cliente controla esses erros).
 * - Qualquer outro: 500 INDISPONIVEL sem stack nem mensagem interna; a causa vai só para o log
 *   do servidor, em error, com o requestId.
 */
@Catch()
export class FiltroDeExcecoes implements ExceptionFilter {
  constructor(@Inject(HttpAdapterHost) private readonly hospedeiroHttp: HttpAdapterHost) {}

  catch(excecao: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const requisicao = http.getRequest<RequisicaoComLog>();
    const { status, corpo } = this.traduzir(excecao, requisicao);
    this.hospedeiroHttp.httpAdapter.reply(http.getResponse(), falha(corpo), status);
  }

  private traduzir(excecao: unknown, requisicao: RequisicaoComLog): Traducao {
    if (excecao instanceof ErroApi) {
      if (excecao.status >= STATUS_PRIMEIRO_5XX) {
        requisicao.log.error({ codigo: excecao.codigo, status: excecao.status }, excecao.message);
      }
      const corpo: CorpoDoErro = excecao.detalhes
        ? { codigo: excecao.codigo, mensagem: excecao.message, detalhes: excecao.detalhes }
        : { codigo: excecao.codigo, mensagem: excecao.message };
      return { status: excecao.status, corpo };
    }

    const status = statusDoFramework(excecao);
    if (status !== undefined && status >= STATUS_PRIMEIRO_4XX && status < STATUS_PRIMEIRO_5XX) {
      const codigo = CODIGO_POR_STATUS_4XX[status] ?? CODIGO_4XX_PADRAO;
      requisicao.log.warn({ status, codigo, ...identificar(excecao) }, 'requisição recusada');
      return { status, corpo: corpoPadrao(codigo) };
    }

    requisicao.log.error({ err: excecao }, 'erro não tratado');
    return { status: HttpStatus.INTERNAL_SERVER_ERROR, corpo: corpoPadrao('INDISPONIVEL') };
  }
}
