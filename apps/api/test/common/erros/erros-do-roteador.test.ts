import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';

import { responderErroDoRoteador } from '../../../src/common/erros/erros-do-roteador.js';

/** Resposta em memória: guarda o status e o corpo enviados. */
function respostaEmMemoria(): {
  resposta: FastifyReply;
  enviado: { status?: number; corpo?: unknown };
} {
  const enviado: { status?: number; corpo?: unknown } = {};
  const resposta = {
    code(status: number) {
      enviado.status = status;
      return this;
    },
    send(corpo: unknown) {
      enviado.corpo = corpo;
      return this;
    },
  };
  return { resposta: resposta as unknown as FastifyReply, enviado };
}

function erroBadUrl(): FastifyError {
  return Object.assign(new Error("'/api/%E0' is not a valid url component"), {
    code: 'FST_ERR_BAD_URL',
    statusCode: 400,
  }) as FastifyError;
}

describe('responderErroDoRoteador', () => {
  it('responde o erro do roteador no envelope', () => {
    const { resposta, enviado } = respostaEmMemoria();
    const requisicao = { log: { warn: () => undefined, error: () => undefined } };

    responderErroDoRoteador(erroBadUrl(), requisicao as unknown as FastifyRequest, resposta);

    expect(enviado).toEqual({
      status: 400,
      corpo: {
        sucesso: false,
        erro: { codigo: 'DADOS_INVALIDOS', mensagem: 'Requisição inválida.' },
      },
    });
  });

  it('se a tradução lançar, responde 500 INDISPONIVEL fixo e registra a falha em error', () => {
    const { resposta, enviado } = respostaEmMemoria();
    const erros: unknown[] = [];
    const requisicao = {
      log: {
        warn: () => {
          throw new Error('logger quebrado');
        },
        error: (objeto: unknown) => erros.push(objeto),
      },
    };

    expect(() =>
      responderErroDoRoteador(erroBadUrl(), requisicao as unknown as FastifyRequest, resposta),
    ).not.toThrow();

    expect(enviado).toEqual({
      status: 500,
      corpo: { sucesso: false, erro: { codigo: 'INDISPONIVEL', mensagem: expect.any(String) } },
    });
    expect(erros).toHaveLength(1);
  });

  it('se até o log de error lançar, ainda responde 500 INDISPONIVEL', () => {
    const { resposta, enviado } = respostaEmMemoria();
    const quebrar = (): never => {
      throw new Error('logger quebrado');
    };
    const requisicao = { log: { warn: quebrar, error: quebrar } };

    expect(() =>
      responderErroDoRoteador(erroBadUrl(), requisicao as unknown as FastifyRequest, resposta),
    ).not.toThrow();

    expect(enviado.status).toBe(500);
  });
});
