import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { ErroApi } from '../../../src/common/erros/erro-api.js';
import { type LogDaRequisicao, traduzirExcecao } from '../../../src/common/erros/traducao.js';

interface Chamada {
  readonly nivel: 'error' | 'warn';
  readonly objeto: Record<string, unknown>;
}

function logEmMemoria(): { log: LogDaRequisicao; chamadas: Chamada[] } {
  const chamadas: Chamada[] = [];
  return {
    chamadas,
    log: {
      error: (objeto) => chamadas.push({ nivel: 'error', objeto: { ...objeto } }),
      warn: (objeto) => chamadas.push({ nivel: 'warn', objeto: { ...objeto } }),
    },
  };
}

/** Erro como os que o Fastify cria (createError): Error com `code` e `statusCode`. */
function erroDoFastify(code: string, statusCode: number): Error {
  return Object.assign(new Error('mensagem interna do Fastify'), { code, statusCode });
}

interface Caso {
  readonly nome: string;
  readonly excecao: unknown;
  readonly status: number;
  readonly codigo: string;
  readonly nivel: 'error' | 'warn' | undefined;
}

const CASOS: readonly Caso[] = [
  {
    nome: 'ErroApi 4xx: código e status próprios, sem log',
    excecao: new ErroApi({ codigo: 'LOTE_ENCERRADO', status: 409, mensagem: 'Lote encerrado.' }),
    status: 409,
    codigo: 'LOTE_ENCERRADO',
    nivel: undefined,
  },
  {
    nome: 'ErroApi 5xx: código e status próprios, log em error',
    excecao: new ErroApi({ codigo: 'CATALOGO_INDISPONIVEL', status: 503, mensagem: 'x' }),
    status: 503,
    codigo: 'CATALOGO_INDISPONIVEL',
    nivel: 'error',
  },
  {
    nome: 'HttpException 4xx: mantém o status, log em warn',
    excecao: new HttpException('interna', 422),
    status: 422,
    codigo: 'DADOS_INVALIDOS',
    nivel: 'warn',
  },
  {
    nome: 'HttpException 403: PAPEL_NAO_PERMITIDO',
    excecao: new HttpException('interna', 403),
    status: 403,
    codigo: 'PAPEL_NAO_PERMITIDO',
    nivel: 'warn',
  },
  {
    nome: 'HttpException 5xx: mantém o status, INDISPONIVEL, log em error',
    excecao: new HttpException('interna', 503),
    status: 503,
    codigo: 'INDISPONIVEL',
    nivel: 'error',
  },
  {
    nome: 'HttpException 3xx: fora da faixa de erro vira 500',
    excecao: new HttpException('interna', 302),
    status: 500,
    codigo: 'INDISPONIVEL',
    nivel: 'error',
  },
  {
    nome: 'HttpException 600: fora da faixa vira 500',
    excecao: new HttpException('interna', 600),
    status: 500,
    codigo: 'INDISPONIVEL',
    nivel: 'error',
  },
  {
    nome: 'Fastify FST_ERR_* 4xx: mantém o status, log em warn',
    excecao: erroDoFastify('FST_ERR_CTP_INVALID_MEDIA_TYPE', 415),
    status: 415,
    codigo: 'DADOS_INVALIDOS',
    nivel: 'warn',
  },
  {
    nome: 'Fastify FST_ERR_VALIDATION (com validation): 400',
    excecao: Object.assign(erroDoFastify('FST_ERR_VALIDATION', 400), { validation: [] }),
    status: 400,
    codigo: 'DADOS_INVALIDOS',
    nivel: 'warn',
  },
  {
    nome: 'só com validation, sem code FST_ERR_*: não é do Fastify, vira 500',
    excecao: Object.assign(new Error('x'), { statusCode: 400, validation: [] }),
    status: 500,
    codigo: 'INDISPONIVEL',
    nivel: 'error',
  },
  {
    nome: 'Fastify FST_ERR_ASYNC_CONSTRAINT (500): vira 500 INDISPONIVEL',
    excecao: erroDoFastify('FST_ERR_ASYNC_CONSTRAINT', 500),
    status: 500,
    codigo: 'INDISPONIVEL',
    nivel: 'error',
  },
  {
    nome: 'Fastify FST_ERR_* com status 3xx: vira 500',
    excecao: erroDoFastify('FST_ERR_QUALQUER', 302),
    status: 500,
    codigo: 'INDISPONIVEL',
    nivel: 'error',
  },
  {
    nome: 'Fastify FST_ERR_* com statusCode não inteiro: vira 500',
    excecao: erroDoFastify('FST_ERR_QUALQUER', 400.5),
    status: 500,
    codigo: 'INDISPONIVEL',
    nivel: 'error',
  },
  {
    nome: 'objeto que não é Error, com code FST_ERR_* e statusCode 400: vira 500',
    excecao: { code: 'FST_ERR_BAD_URL', statusCode: 400 },
    status: 500,
    codigo: 'INDISPONIVEL',
    nivel: 'error',
  },
  {
    nome: 'erro de biblioteca com statusCode 404: vira 500',
    excecao: Object.assign(new Error('x'), { statusCode: 404, code: 'ERR_UPSTREAM' }),
    status: 500,
    codigo: 'INDISPONIVEL',
    nivel: 'error',
  },
  {
    nome: 'valor primitivo lançado: vira 500',
    excecao: 'texto',
    status: 500,
    codigo: 'INDISPONIVEL',
    nivel: 'error',
  },
];

describe('traduzirExcecao', () => {
  it.each(CASOS)('$nome', ({ excecao, status, codigo, nivel }) => {
    const { log, chamadas } = logEmMemoria();

    const traducao = traduzirExcecao(excecao, log);

    expect(traducao.status).toBe(status);
    expect(traducao.corpo.codigo).toBe(codigo);
    expect(traducao.corpo.mensagem).toEqual(expect.any(String));
    expect(chamadas.map((chamada) => chamada.nivel)).toEqual(nivel === undefined ? [] : [nivel]);
  });

  it('4xx do framework: o log em warn não leva a mensagem nem o erro', () => {
    const { log, chamadas } = logEmMemoria();

    traduzirExcecao(erroDoFastify('FST_ERR_BAD_URL', 400), log);

    expect(chamadas[0]?.objeto).toEqual({
      status: 400,
      codigo: 'DADOS_INVALIDOS',
      tipo: 'Error',
      codigoInterno: 'FST_ERR_BAD_URL',
    });
  });

  it('ErroApi 5xx: o log em error leva o próprio erro (stack e cause)', () => {
    const { log, chamadas } = logEmMemoria();
    const excecao = new ErroApi({ codigo: 'INDISPONIVEL', status: 503, mensagem: 'x' });

    traduzirExcecao(excecao, log);

    expect(chamadas[0]?.objeto).toMatchObject({ codigo: 'INDISPONIVEL', status: 503 });
    expect(chamadas[0]?.objeto.err).toBe(excecao);
  });

  it('ErroApi mantém mensagem e detalhes no corpo', () => {
    const { log } = logEmMemoria();
    const excecao = new ErroApi({
      codigo: 'SALDO_INSUFICIENTE',
      status: 422,
      mensagem: 'Saldo insuficiente.',
      detalhes: { faltamCentavos: 1500 },
    });

    expect(traduzirExcecao(excecao, log).corpo).toEqual({
      codigo: 'SALDO_INSUFICIENTE',
      mensagem: 'Saldo insuficiente.',
      detalhes: { faltamCentavos: 1500 },
    });
  });
});
