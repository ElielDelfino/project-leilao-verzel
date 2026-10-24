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

const MENSAGEM_INDISPONIVEL = 'Serviço temporariamente indisponível. Tente novamente.';
const MENSAGEM_NAO_ENCONTRADO = 'Recurso não encontrado.';

const STATUS_PRIMEIRO_5XX = 500;

/**
 * Filtro global: toda exceção vira o envelope de erro de specs/001 §Contratos.
 * Erro inesperado responde 500 INDISPONIVEL sem stack nem mensagem interna; o detalhe vai só
 * para o log do servidor, com o requestId.
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
        requisicao.log.warn({ codigo: excecao.codigo, status: excecao.status }, excecao.message);
      }
      const corpo: CorpoDoErro = excecao.detalhes
        ? { codigo: excecao.codigo, mensagem: excecao.message, detalhes: excecao.detalhes }
        : { codigo: excecao.codigo, mensagem: excecao.message };
      return { status: excecao.status, corpo };
    }

    // Rota inexistente: o adaptador Fastify do Nest lança NotFoundException.
    if (excecao instanceof HttpException && excecao.getStatus() === HttpStatus.NOT_FOUND) {
      return {
        status: HttpStatus.NOT_FOUND,
        corpo: { codigo: 'NAO_ENCONTRADO', mensagem: MENSAGEM_NAO_ENCONTRADO },
      };
    }

    requisicao.log.error({ err: excecao }, 'erro não tratado');
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      corpo: { codigo: 'INDISPONIVEL', mensagem: MENSAGEM_INDISPONIVEL },
    };
  }
}
