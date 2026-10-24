// Erros que o roteador do Fastify responde antes de qualquer hook ou rota do Nest: URL malformada
// (FST_ERR_BAD_URL, 400), parâmetro de rota longo demais (FST_ERR_MAX_PARAM_LENGTH, 414) e falha
// de constraint assíncrona (FST_ERR_ASYNC_CONSTRAINT, 500). Sem este handler, o Fastify devolve o
// próprio corpo (com a URL refletida) e loga o erro em info com stack.
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';

import { falha } from '../envelope.js';
import { FALHA_INTERNA, type Traducao, traduzirExcecao } from './traducao.js';

const NIVEL_ERROR_DO_PINO = 50;

/**
 * Último recurso quando nem o logger da requisição funciona: uma linha JSON fixa no stderr, no
 * formato do Pino, sem detalhes do erro (como main.ts faz antes de o logger existir).
 */
function registrarSemLogger(): void {
  const linha = { level: NIVEL_ERROR_DO_PINO, time: new Date().toISOString() };
  process.stderr.write(
    `${JSON.stringify({ ...linha, msg: 'falha ao registrar erro do roteador' })}\n`,
  );
}

/**
 * Traduz sem lançar: este handler roda dentro do roteador do Fastify, e uma exceção aqui
 * escaparia sem resposta. Se a tradução falhar, responde o 500 fixo e registra a causa.
 */
function traduzirComSeguranca(erro: FastifyError, requisicao: FastifyRequest): Traducao {
  try {
    return traduzirExcecao(erro, requisicao.log);
  } catch (falhaNaTraducao: unknown) {
    try {
      requisicao.log.error({ err: falhaNaTraducao }, 'falha ao traduzir erro do roteador');
    } catch {
      registrarSemLogger();
    }
    return FALHA_INTERNA;
  }
}

/** Handler para a opção `frameworkErrors` do Fastify: responde no envelope de erro. */
export function responderErroDoRoteador(
  erro: FastifyError,
  requisicao: FastifyRequest,
  resposta: FastifyReply,
): void {
  const { status, corpo } = traduzirComSeguranca(erro, requisicao);
  void resposta.code(status).send(falha(corpo));
}
