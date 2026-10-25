// Integração (Postgres e Redis reais): rotas da tag carteira (specs/004 §Comportamento,
// §Interfaces e contratos, §Critérios de aceite; tarefa 039). Os usuários são inseridos direto
// em `users` (o cadastro é de identidade) e a sessão vem de um access token assinado no teste.
import { randomUUID } from 'node:crypto';

import type { LightMyRequestResponse } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { emitirAccessToken } from '../../../src/modules/identidade/tokens.js';
import {
  type AppDeIdentidade,
  BANCO,
  CHAVE_JWT,
  criarAppDeIdentidade,
  emailNovo,
  INFRA_DISPONIVEL,
} from '../identidade/ambiente.js';

type Papel = 'leiloeiro' | 'licitante';

const CSRF = 'csrf-de-teste-da-carteira';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface Conta {
  readonly id: string;
  readonly cabecalhos: Readonly<Record<string, string>>;
}

describe.skipIf(!INFRA_DISPONIVEL)('carteira com Postgres e Redis reais', () => {
  let ctx: AppDeIdentidade;
  let pool: pg.Pool;
  const criados: string[] = [];

  beforeAll(async () => {
    ctx = await criarAppDeIdentidade();
    // Sem espalhar a conexão: a senha não é propriedade enumerável (não vaza em logs).
    pool = new pg.Pool(BANCO.conexao());
  });

  afterAll(async () => {
    await pool.end();
    await ctx.fechar();
  });

  async function novaConta(papel: Papel = 'licitante'): Promise<Conta> {
    const { rows } = await pool.query<{ id: string }>(
      `insert into users (nome, email, senha_hash, papel) values ($1, $2, $3, $4) returning id`,
      ['Conta de Teste', emailNovo(), 'hash-que-nao-e-usado', papel],
    );
    const id = rows[0]?.id;
    if (id === undefined) {
      throw new Error('insert em users não devolveu o id');
    }
    criados.push(id);
    const token = await emitirAccessToken(CHAVE_JWT, { id, papel });
    return {
      id,
      cabecalhos: { cookie: `access_token=${token}; csrf_token=${CSRF}`, 'x-csrf-token': CSRF },
    };
  }

  function get(conta: Conta | undefined, url: string): Promise<LightMyRequestResponse> {
    return ctx.app.inject({ method: 'GET', url, headers: conta?.cabecalhos ?? {} });
  }

  function depositar(
    conta: Conta,
    corpo: unknown,
    // null = sem o header (undefined acionaria o valor padrão).
    chave: string | null = randomUUID(),
    extras: Record<string, string> = {},
  ): Promise<LightMyRequestResponse> {
    const headers: Record<string, string> = { ...conta.cabecalhos, ...extras };
    if (chave !== null) {
      headers['idempotency-key'] = chave;
    }
    return ctx.app.inject({
      method: 'POST',
      url: '/api/carteira/depositos',
      headers,
      payload: corpo as object,
    });
  }

  async function lancamentosDe(userId: string): Promise<number> {
    const { rows } = await pool.query<{ n: string }>(
      'select count(*) as n from ledger_entries where user_id = $1',
      [userId],
    );
    return Number(rows[0]?.n);
  }

  function codigo(resposta: LightMyRequestResponse): unknown {
    return (resposta.json() as { erro?: { codigo?: unknown } }).erro?.codigo;
  }

  describe('GET /api/carteira', () => {
    it('sem lançamentos: 200 com zeros e nenhuma linha em wallet_balances (D13)', async () => {
      const conta = await novaConta();

      const resposta = await get(conta, '/api/carteira');

      expect(resposta.statusCode).toBe(200);
      expect(resposta.json()).toEqual({
        sucesso: true,
        dados: { totalCentavos: 0, comprometidoCentavos: 0, disponivelCentavos: 0 },
      });
      const { rows } = await pool.query('select 1 from wallet_balances where user_id = $1', [
        conta.id,
      ]);
      expect(rows).toHaveLength(0);
    });

    it('leiloeiro também consulta o saldo (RF-02)', async () => {
      const resposta = await get(await novaConta('leiloeiro'), '/api/carteira');

      expect(resposta.statusCode).toBe(200);
    });

    it('sem sessão → 401 NAO_AUTENTICADO', async () => {
      const resposta = await get(undefined, '/api/carteira');

      expect(resposta.statusCode).toBe(401);
      expect(codigo(resposta)).toBe('NAO_AUTENTICADO');
    });

    it('disponível = total − comprometido, lido da projeção', async () => {
      const conta = await novaConta();
      await depositar(conta, { valorCentavos: 5000 });
      // Compromisso de F3 simulado direto no banco (o teste conecta como dono).
      await pool.query(
        `insert into ledger_entries (user_id, tipo, valor_centavos) values ($1, 'compromisso', 1200)`,
        [conta.id],
      );
      await pool.query(
        'update wallet_balances set comprometido_centavos = 1200 where user_id = $1',
        [conta.id],
      );

      const resposta = await get(conta, '/api/carteira');

      expect(resposta.json()).toEqual({
        sucesso: true,
        dados: { totalCentavos: 5000, comprometidoCentavos: 1200, disponivelCentavos: 3800 },
      });
    });
  });

  describe('POST /api/carteira/depositos', () => {
    it('primeiro depósito de R$ 10,00: 201 {lancamento, saldo} e uma linha com total 1000', async () => {
      const conta = await novaConta();

      const resposta = await depositar(conta, { valorCentavos: 1000 });

      expect(resposta.statusCode).toBe(201);
      expect(resposta.json()).toEqual({
        sucesso: true,
        dados: {
          lancamento: {
            id: expect.stringMatching(UUID),
            tipo: 'deposito',
            valorCentavos: 1000,
            loteId: null,
            criadoEm: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
          },
          saldo: { totalCentavos: 1000, comprometidoCentavos: 0, disponivelCentavos: 1000 },
        },
      });
      const { rows } = await pool.query<{ total: string }>(
        'select total_centavos as total from wallet_balances where user_id = $1',
        [conta.id],
      );
      expect(rows).toEqual([{ total: '1000' }]);
    });

    it.each([100, 10_000_000])('valor %i (limite) → 201', async (valor) => {
      const resposta = await depositar(await novaConta(), { valorCentavos: valor });

      expect(resposta.statusCode).toBe(201);
    });

    it.each([
      ['99', { valorCentavos: 99 }],
      ['10.000.001', { valorCentavos: 10_000_001 }],
      ['não inteiro', { valorCentavos: 150.5 }],
      ['texto', { valorCentavos: '1000' }],
      ['sem valor', {}],
      ['campo desconhecido', { valorCentavos: 1000, extra: true }],
    ])('corpo inválido (%s) → 422 DADOS_INVALIDOS sem lançamento', async (_nome, corpo) => {
      const conta = await novaConta();

      const resposta = await depositar(conta, corpo);

      expect(resposta.statusCode).toBe(422);
      expect(codigo(resposta)).toBe('DADOS_INVALIDOS');
      expect(await lancamentosDe(conta.id)).toBe(0);
    });

    it.each([
      ['ausente', null],
      ['não UUID', 'nao-e-uuid'],
      ['vazio', ''],
    ])('Idempotency-Key %s → 422 DADOS_INVALIDOS', async (_nome, chave) => {
      const conta = await novaConta();

      const resposta = await depositar(conta, { valorCentavos: 1000 }, chave);

      expect(resposta.statusCode).toBe(422);
      expect(codigo(resposta)).toBe('DADOS_INVALIDOS');
      expect(await lancamentosDe(conta.id)).toBe(0);
    });

    it('leiloeiro → 403 PAPEL_NAO_PERMITIDO', async () => {
      const conta = await novaConta('leiloeiro');

      const resposta = await depositar(conta, { valorCentavos: 1000 });

      expect(resposta.statusCode).toBe(403);
      expect(codigo(resposta)).toBe('PAPEL_NAO_PERMITIDO');
      expect(await lancamentosDe(conta.id)).toBe(0);
    });

    it('sem sessão → 401', async () => {
      const resposta = await ctx.app.inject({
        method: 'POST',
        url: '/api/carteira/depositos',
        headers: {
          cookie: `csrf_token=${CSRF}`,
          'x-csrf-token': CSRF,
          'idempotency-key': randomUUID(),
        },
        payload: { valorCentavos: 1000 },
      });

      expect(resposta.statusCode).toBe(401);
      expect(codigo(resposta)).toBe('NAO_AUTENTICADO');
    });

    it('sem CSRF → 403 CSRF_INVALIDO', async () => {
      const conta = await novaConta();

      const resposta = await depositar(conta, { valorCentavos: 1000 }, randomUUID(), {
        'x-csrf-token': 'outro',
      });

      expect(resposta.statusCode).toBe(403);
      expect(codigo(resposta)).toBe('CSRF_INVALIDO');
    });

    it('mesma chave e mesmo corpo → 200 com o mesmo lançamento e o saldo atual', async () => {
      const conta = await novaConta();
      const chave = randomUUID();
      const primeira = await depositar(conta, { valorCentavos: 2000 }, chave);
      await depositar(conta, { valorCentavos: 300 });

      const repeticao = await depositar(conta, { valorCentavos: 2000 }, chave);

      expect(primeira.statusCode).toBe(201);
      expect(repeticao.statusCode).toBe(200);
      const dadosDaPrimeira = (primeira.json() as { dados: { lancamento: unknown } }).dados;
      expect(repeticao.json()).toEqual({
        sucesso: true,
        dados: {
          lancamento: dadosDaPrimeira.lancamento,
          saldo: { totalCentavos: 2300, comprometidoCentavos: 0, disponivelCentavos: 2300 },
        },
      });
      expect(await lancamentosDe(conta.id)).toBe(2);
    });

    it('mesma chave e corpo diferente → 422 DADOS_INVALIDOS sem lançamento novo', async () => {
      const conta = await novaConta();
      const chave = randomUUID();
      await depositar(conta, { valorCentavos: 2000 }, chave);

      const resposta = await depositar(conta, { valorCentavos: 2001 }, chave);

      expect(resposta.statusCode).toBe(422);
      expect(codigo(resposta)).toBe('DADOS_INVALIDOS');
      expect(await lancamentosDe(conta.id)).toBe(1);
    });

    it('a mesma chave em usuários diferentes são depósitos distintos', async () => {
      const chave = randomUUID();

      const a = await depositar(await novaConta(), { valorCentavos: 1000 }, chave);
      const b = await depositar(await novaConta(), { valorCentavos: 1000 }, chave);

      expect([a.statusCode, b.statusCode]).toEqual([201, 201]);
    });

    it('10 concorrentes com a mesma chave → um 201, nove 200 e um lançamento', async () => {
      const conta = await novaConta();
      const chave = randomUUID();

      const respostas = await Promise.all(
        Array.from({ length: 10 }, () => depositar(conta, { valorCentavos: 700 }, chave)),
      );

      const status = respostas.map((r) => r.statusCode).sort();
      expect(status).toEqual([200, 200, 200, 200, 200, 200, 200, 200, 200, 201]);
      const ids = new Set(
        respostas.map(
          (r) => (r.json() as { dados: { lancamento: { id: string } } }).dados.lancamento.id,
        ),
      );
      expect(ids.size).toBe(1);
      expect(await lancamentosDe(conta.id)).toBe(1);
      expect((await get(conta, '/api/carteira')).json()).toMatchObject({
        dados: { totalCentavos: 700 },
      });
    });

    it('20 concorrentes com chaves diferentes → total é a soma', async () => {
      const conta = await novaConta();
      const valores = Array.from({ length: 20 }, (_, i) => 100 + i);

      const respostas = await Promise.all(
        valores.map((valor) => depositar(conta, { valorCentavos: valor })),
      );

      expect(respostas.every((r) => r.statusCode === 201)).toBe(true);
      const soma = valores.reduce((a, b) => a + b, 0);
      expect((await get(conta, '/api/carteira')).json()).toEqual({
        sucesso: true,
        dados: { totalCentavos: soma, comprometidoCentavos: 0, disponivelCentavos: soma },
      });
      expect(await lancamentosDe(conta.id)).toBe(20);
    });
  });

  describe('GET /api/carteira/extrato', () => {
    interface Pagina {
      dados: { valorCentavos: number }[];
      meta: { total: number; pagina: number; limite: number };
    }

    it('sem lançamentos → 200 com dados [] e meta.total 0', async () => {
      const resposta = await get(await novaConta(), '/api/carteira/extrato');

      expect(resposta.statusCode).toBe(200);
      expect(resposta.json()).toEqual({
        sucesso: true,
        dados: [],
        meta: { total: 0, pagina: 1, limite: 20 },
      });
    });

    it('25 lançamentos: página 1 com 20 decrescentes, 2 com 5, 3 vazia, total 25', async () => {
      const conta = await novaConta();
      const valores = Array.from({ length: 25 }, (_, i) => 100 + i);
      for (const valor of valores) {
        // Sequencial: a ordem de criação é a ordem dos valores.
        await depositar(conta, { valorCentavos: valor });
      }
      const decrescentes = [...valores].reverse();

      const [p1, p2, p3] = await Promise.all(
        [1, 2, 3].map((n) => get(conta, `/api/carteira/extrato?pagina=${n}`)),
      );

      expect([p1?.statusCode, p2?.statusCode, p3?.statusCode]).toEqual([200, 200, 200]);
      const pagina1 = p1?.json() as Pagina;
      const pagina2 = p2?.json() as Pagina;
      expect(pagina1.dados.map((l) => l.valorCentavos)).toEqual(decrescentes.slice(0, 20));
      expect(pagina1.meta).toEqual({ total: 25, pagina: 1, limite: 20 });
      expect(pagina2.dados.map((l) => l.valorCentavos)).toEqual(decrescentes.slice(20));
      expect(p3?.json()).toEqual({
        sucesso: true,
        dados: [],
        meta: { total: 25, pagina: 3, limite: 20 },
      });
      expect(pagina1.dados[0]).toEqual({
        id: expect.stringMatching(UUID),
        tipo: 'deposito',
        valorCentavos: 124,
        loteId: null,
        criadoEm: expect.any(String),
      });
    });

    it('leiloeiro também consulta o extrato (RF-02)', async () => {
      const resposta = await get(await novaConta('leiloeiro'), '/api/carteira/extrato');

      expect(resposta.statusCode).toBe(200);
    });

    it('sem sessão → 401', async () => {
      expect((await get(undefined, '/api/carteira/extrato')).statusCode).toBe(401);
    });

    it.each(['0', 'abc', '-1', '1.5', '', '01', '99999999999999999999'])(
      'pagina=%s → 422 DADOS_INVALIDOS',
      async (pagina) => {
        const resposta = await get(await novaConta(), `/api/carteira/extrato?pagina=${pagina}`);

        expect(resposta.statusCode).toBe(422);
        expect(codigo(resposta)).toBe('DADOS_INVALIDOS');
      },
    );

    it('pagina repetida na query → 422', async () => {
      const resposta = await get(await novaConta(), '/api/carteira/extrato?pagina=1&pagina=2');

      expect(resposta.statusCode).toBe(422);
    });
  });

  describe('reconciliação (RNF-02)', () => {
    it('projeção == Σ ledger para os usuários criados neste arquivo', async () => {
      const { rows } = await pool.query<{ user_id: string; total: string; comprometido: string }>(
        `select u.id as user_id,
                coalesce(w.total_centavos, 0)::text as total,
                coalesce(w.comprometido_centavos, 0)::text as comprometido
           from unnest($1::uuid[]) as u(id)
           left join wallet_balances w on w.user_id = u.id`,
        [criados],
      );
      const { rows: somas } = await pool.query<{
        user_id: string;
        total: string;
        comprometido: string;
      }>(
        `select u.id as user_id,
                coalesce(sum(case l.tipo when 'deposito' then l.valor_centavos
                                         when 'credito_arremate' then l.valor_centavos
                                         when 'debito_arremate' then -l.valor_centavos
                                         else 0 end), 0)::text as total,
                coalesce(sum(case l.tipo when 'compromisso' then l.valor_centavos
                                         when 'liberacao' then -l.valor_centavos
                                         when 'estorno' then -l.valor_centavos
                                         when 'debito_arremate' then -l.valor_centavos
                                         else 0 end), 0)::text as comprometido
           from unnest($1::uuid[]) as u(id)
           left join ledger_entries l on l.user_id = u.id
          group by u.id`,
        [criados],
      );

      expect(criados.length).toBeGreaterThan(0);
      const ordenar = <T extends { user_id: string }>(xs: T[]): T[] =>
        [...xs].sort((a, b) => a.user_id.localeCompare(b.user_id));
      expect(ordenar(rows)).toEqual(ordenar(somas));
    });
  });
});
