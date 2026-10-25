import { type ArgumentsHost, Catch, type ExceptionFilter, Inject } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';

import { falha } from '../envelope.js';
import { type LogDaRequisicao, traduzirExcecao } from './traducao.js';

/** O que o filtro usa da requisição do Fastify: o logger filho, já com o requestId. */
interface RequisicaoComLog {
  readonly log: LogDaRequisicao;
}

/**
 * Filtro global: toda exceção que passa pelo Nest vira o envelope de erro de specs/001
 * §Contratos. As regras de status, código e nível de log estão em traduzirExcecao.
 */
@Catch()
export class FiltroDeExcecoes implements ExceptionFilter {
  constructor(@Inject(HttpAdapterHost) private readonly hospedeiroHttp: HttpAdapterHost) {}

  catch(excecao: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const requisicao = http.getRequest<RequisicaoComLog>();
    const { status, corpo, cabecalhos } = traduzirExcecao(excecao, requisicao.log);
    const adaptador = this.hospedeiroHttp.httpAdapter;
    const resposta: unknown = http.getResponse();
    for (const [nome, valor] of Object.entries(cabecalhos ?? {})) {
      adaptador.setHeader(resposta, nome, valor);
    }
    adaptador.reply(resposta, falha(corpo), status);
  }
}
