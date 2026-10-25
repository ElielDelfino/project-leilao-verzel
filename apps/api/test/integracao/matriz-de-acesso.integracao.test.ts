// Matriz papel (anônimo, licitante, leiloeiro) × operação, com e sem CSRF, para todas as operações
// das tags `auth` e `carteira` do openapi.yaml (task 043; specs/003 §CSRF e papéis, specs/004 RF-03).
// Cada resposta também é validada contra o contrato pelo criarAppDeTeste (specs/013 §Contratos).
import { randomUUID } from 'node:crypto';

import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { operacoesDoContrato } from '../helpers/contrato.js';
import {
  type AppDeIdentidade,
  cadastrar,
  criarAppDeIdentidade,
  emailNovo,
  INFRA_DISPONIVEL,
  Navegador,
  SENHA,
} from '../modules/identidade/ambiente.js';

type Papel = 'anonimo' | 'licitante' | 'leiloeiro';
const PAPEIS: readonly Papel[] = ['anonimo', 'licitante', 'leiloeiro'];

interface Esperado {
  readonly status: number;
  readonly codigo?: string;
}

interface Operacao {
  readonly metodo: 'GET' | 'POST';
  readonly caminho: string;
  /** Corpo (e headers extras) válidos para a operação; recebe o e-mail de uma conta existente. */
  readonly corpo?: (email: string) => object;
  readonly extras?: () => Record<string, string>;
  /** Resultado com CSRF válido, por papel. */
  readonly comCsrf: Readonly<Record<Papel, Esperado>>;
  /** Operações de leitura não exigem CSRF; as demais respondem 403 CSRF_INVALIDO sem ele. */
  readonly exigeCsrf: boolean;
}

const igualParaTodos = (e: Esperado): Operacao['comCsrf'] => ({
  anonimo: e,
  licitante: e,
  leiloeiro: e,
});

const OPERACOES: readonly Operacao[] = [
  {
    metodo: 'GET',
    caminho: '/api/auth/csrf',
    exigeCsrf: false,
    comCsrf: igualParaTodos({ status: 204 }),
  },
  {
    metodo: 'POST',
    caminho: '/api/auth/cadastro',
    exigeCsrf: true,
    corpo: () => ({ nome: 'Conta de Teste', email: emailNovo(), senha: SENHA, papel: 'licitante' }),
    comCsrf: igualParaTodos({ status: 201 }),
  },
  {
    metodo: 'POST',
    caminho: '/api/auth/login',
    exigeCsrf: true,
    corpo: (email) => ({ email, senha: SENHA }),
    comCsrf: igualParaTodos({ status: 200 }),
  },
  {
    metodo: 'POST',
    caminho: '/api/auth/refresh',
    exigeCsrf: true,
    comCsrf: {
      anonimo: { status: 401, codigo: 'SESSAO_EXPIRADA' },
      licitante: { status: 204 },
      leiloeiro: { status: 204 },
    },
  },
  {
    metodo: 'POST',
    caminho: '/api/auth/logout',
    exigeCsrf: true,
    comCsrf: igualParaTodos({ status: 204 }),
  },
  {
    metodo: 'GET',
    caminho: '/api/auth/me',
    exigeCsrf: false,
    comCsrf: {
      anonimo: { status: 401, codigo: 'NAO_AUTENTICADO' },
      licitante: { status: 200 },
      leiloeiro: { status: 200 },
    },
  },
  {
    metodo: 'GET',
    caminho: '/api/carteira',
    exigeCsrf: false,
    comCsrf: {
      anonimo: { status: 401, codigo: 'NAO_AUTENTICADO' },
      licitante: { status: 200 },
      leiloeiro: { status: 200 },
    },
  },
  {
    metodo: 'GET',
    caminho: '/api/carteira/extrato',
    exigeCsrf: false,
    comCsrf: {
      anonimo: { status: 401, codigo: 'NAO_AUTENTICADO' },
      licitante: { status: 200 },
      leiloeiro: { status: 200 },
    },
  },
  {
    metodo: 'POST',
    caminho: '/api/carteira/depositos',
    exigeCsrf: true,
    corpo: () => ({ valorCentavos: 1000 }),
    extras: () => ({ 'idempotency-key': randomUUID() }),
    comCsrf: {
      anonimo: { status: 401, codigo: 'NAO_AUTENTICADO' },
      licitante: { status: 201 },
      leiloeiro: { status: 403, codigo: 'PAPEL_NAO_PERMITIDO' },
    },
  },
];

const chaveDe = (o: { metodo: string; caminho: string }): string =>
  `${o.metodo.toUpperCase()} ${o.caminho}`;

describe('cobertura da matriz', () => {
  it('cobre todas as operações das tags auth e carteira do openapi.yaml, e só elas', () => {
    const doContrato = [...operacoesDoContrato('auth'), ...operacoesDoContrato('carteira')]
      .map(chaveDe)
      .sort();

    expect(OPERACOES.map(chaveDe).sort()).toEqual(doContrato);
    expect(doContrato).toHaveLength(9);
  });
});

describe.skipIf(!INFRA_DISPONIVEL)('matriz papel × operação (Postgres e Redis reais)', () => {
  let ctx: AppDeIdentidade;
  let proximoIp = 1;

  beforeAll(async () => {
    ctx = await criarAppDeIdentidade();
  });

  afterAll(async () => {
    await ctx.fechar();
  });

  /** Um IP novo por caso: o limite de 5 por minuto por IP nunca interfere na matriz. */
  function ipNovo(): string {
    return `10.43.${Math.floor(proximoIp / 250)}.${(proximoIp++ % 250) + 1}`;
  }

  async function navegadorDe(papel: Papel): Promise<Navegador> {
    const navegador = new Navegador(ctx.app, ipNovo());
    if (papel === 'anonimo') {
      await navegador.obterCsrf();
    } else {
      const { resposta } = await cadastrar(navegador, { papel });
      expect(resposta.statusCode).toBe(201);
    }
    return navegador;
  }

  async function chamar(
    navegador: Navegador,
    operacao: Operacao,
    email: string,
    comCsrf: boolean,
  ): Promise<LightMyRequestResponse> {
    const csrf = navegador.cookies.get('csrf_token');
    const headers: Record<string, string> = {
      cookie: navegador.cabecalhoCookie(),
      ...(operacao.extras?.() ?? {}),
    };
    if (comCsrf && csrf !== undefined) {
      headers['x-csrf-token'] = csrf;
    }
    return ctx.app.inject({
      method: operacao.metodo,
      url: operacao.caminho,
      headers,
      ...(operacao.corpo ? { payload: operacao.corpo(email) } : {}),
    });
  }

  async function contaExistente(): Promise<string> {
    const { email, resposta } = await cadastrar(new Navegador(ctx.app, ipNovo()));
    expect(resposta.statusCode).toBe(201);
    return email;
  }

  describe.each(OPERACOES)('$metodo $caminho', (operacao) => {
    it.each(PAPEIS)('%s com CSRF válido', async (papel) => {
      const navegador = await navegadorDe(papel);
      const email = await contaExistente();

      const resposta = await chamar(navegador, operacao, email, true);

      const esperado = operacao.comCsrf[papel];
      expect(resposta.statusCode).toBe(esperado.status);
      if (esperado.codigo !== undefined) {
        expect((resposta.json() as { erro: { codigo: string } }).erro.codigo).toBe(esperado.codigo);
      }
    });

    it.each(PAPEIS)('%s sem o header X-CSRF-Token', async (papel) => {
      const navegador = await navegadorDe(papel);
      const email = await contaExistente();

      const resposta = await chamar(navegador, operacao, email, false);

      if (operacao.exigeCsrf) {
        expect(resposta.statusCode).toBe(403);
        expect((resposta.json() as { erro: { codigo: string } }).erro.codigo).toBe('CSRF_INVALIDO');
      } else {
        expect(resposta.statusCode).toBe(operacao.comCsrf[papel].status);
      }
    });
  });
});
