// Fluxo cadastro → depósito → extrato pela API e reconciliação da carteira (task 043;
// specs/004 RNF-02 e §Critérios de aceite). As respostas são validadas contra o contrato.
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type AppDeIdentidade,
  BANCO,
  cadastrar,
  criarAppDeIdentidade,
  INFRA_DISPONIVEL,
  Navegador,
} from '../modules/identidade/ambiente.js';
import {
  descreverDivergencias,
  divergenciasDaCarteira,
  exigirCarteiraReconciliada,
} from './reconciliacao.js';

describe.skipIf(!INFRA_DISPONIVEL)('fluxo pela API e reconciliação', () => {
  let ctx: AppDeIdentidade;
  let pool: pg.Pool;

  beforeAll(async () => {
    ctx = await criarAppDeIdentidade();
    pool = new pg.Pool(BANCO.conexao());
  });

  afterAll(async () => {
    await pool.end();
    await ctx.fechar();
  });

  async function depositar(navegador: Navegador, valorCentavos: number) {
    return ctx.app.inject({
      method: 'POST',
      url: '/api/carteira/depositos',
      headers: {
        cookie: navegador.cabecalhoCookie(),
        'x-csrf-token': navegador.cookies.get('csrf_token') ?? '',
        'idempotency-key': randomUUID(),
      },
      payload: { valorCentavos },
    });
  }

  async function idDoUsuario(navegador: Navegador): Promise<string> {
    const me = (await navegador.get('/api/auth/me')).json() as { dados: { id: string } };
    return me.dados.id;
  }

  it('cadastro → depósito → extrato: o saldo e o extrato refletem os depósitos', async () => {
    const navegador = new Navegador(ctx.app, '10.44.0.1');
    expect((await cadastrar(navegador)).resposta.statusCode).toBe(201);

    expect((await depositar(navegador, 2500)).statusCode).toBe(201);
    expect((await depositar(navegador, 700)).statusCode).toBe(201);

    expect((await navegador.get('/api/carteira')).json()).toEqual({
      sucesso: true,
      dados: { totalCentavos: 3200, comprometidoCentavos: 0, disponivelCentavos: 3200 },
    });
    const extrato = (await navegador.get('/api/carteira/extrato')).json() as {
      dados: { tipo: string; valorCentavos: number }[];
      meta: { total: number };
    };
    expect(extrato.dados.map((l) => [l.tipo, l.valorCentavos])).toEqual([
      ['deposito', 700],
      ['deposito', 2500],
    ]);
    expect(extrato.meta.total).toBe(2);
  });

  it('projeção == Σ ledger para o usuário depois dos depósitos', async () => {
    const navegador = new Navegador(ctx.app, '10.44.0.2');
    await cadastrar(navegador);
    await depositar(navegador, 1234);
    const id = await idDoUsuario(navegador);

    const divergencias = await divergenciasDaCarteira(pool);

    expect(divergencias.filter((d) => d.userId === id)).toEqual([]);
  });

  it('projeção alterada à mão → divergência com o id do usuário, sem e-mail', async () => {
    const navegador = new Navegador(ctx.app, '10.44.0.3');
    const { email } = await cadastrar(navegador);
    await depositar(navegador, 1000);
    const id = await idDoUsuario(navegador);
    await pool.query(
      'update wallet_balances set total_centavos = total_centavos + 1 where user_id = $1',
      [id],
    );

    try {
      const divergencias = await divergenciasDaCarteira(pool);
      const minha = divergencias.find((d) => d.userId === id);
      expect(minha).toEqual({
        userId: id,
        ledgerTotalCentavos: 1000,
        ledgerComprometidoCentavos: 0,
        projecaoTotalCentavos: 1001,
        projecaoComprometidoCentavos: 0,
      });
      const mensagem = descreverDivergencias(divergencias);
      expect(mensagem).toContain(id);
      expect(mensagem).not.toContain(email);
      await expect(exigirCarteiraReconciliada(pool)).rejects.toThrow(id);
    } finally {
      await pool.query(
        'update wallet_balances set total_centavos = total_centavos - 1 where user_id = $1',
        [id],
      );
    }
    expect((await divergenciasDaCarteira(pool)).filter((d) => d.userId === id)).toEqual([]);
  });

  it('lançamentos de compromisso e estorno entram no cálculo (tabela de efeitos)', async () => {
    const navegador = new Navegador(ctx.app, '10.44.0.4');
    await cadastrar(navegador);
    await depositar(navegador, 5000);
    const id = await idDoUsuario(navegador);
    // Compromisso de 1200 e estorno de 200, como na F3 (simulados no banco, como dono).
    await pool.query(
      `insert into ledger_entries (user_id, tipo, valor_centavos) values
         ($1, 'compromisso', 1200), ($1, 'estorno', 200)`,
      [id],
    );
    await pool.query('update wallet_balances set comprometido_centavos = 1000 where user_id = $1', [
      id,
    ]);

    expect((await divergenciasDaCarteira(pool)).filter((d) => d.userId === id)).toEqual([]);
  });
});
