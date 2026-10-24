// Erros que o roteador do Fastify responde antes de qualquer hook ou rota do Nest: URL malformada
// (FST_ERR_BAD_URL, 400), parâmetro de rota longo demais (FST_ERR_MAX_PARAM_LENGTH, 414) e falha
// de constraint assíncrona (FST_ERR_ASYNC_CONSTRAINT, 500). Sem este handler, o Fastify devolve o
// próprio corpo (com a URL refletida) e loga o erro em info com stack.
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';

import { falha } from '../envelope.js';
import { traduzirExcecao } from './traducao.js';

/** Handler para a opção `frameworkErrors` do Fastify: responde no envelope de erro. */
export function responderErroDoRoteador(
  erro: FastifyError,
  requisicao: FastifyRequest,
  resposta: FastifyReply,
): void {
  const { status, corpo } = traduzirExcecao(erro, requisicao.log);
  void resposta.code(status).send(falha(corpo));
}
