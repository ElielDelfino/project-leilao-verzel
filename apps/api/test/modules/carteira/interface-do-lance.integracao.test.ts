// Integração (Postgres real): comprometer, liberar e travarCarteiras (tarefa 074; specs/004
// §Comportamento, D12) e a reconciliação dos 6 tipos de lançamento pelo caminho real do módulo
// (nota da 039). Os usuários são inseridos direto em `users` (o cadastro é de identidade).
import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type BancoVerificavel, criarBanco, type Transacao } from '../../../src/db/banco.js';
import {
  comprometer,
  ErroDeCarteira,
  liberar,
  travarCarteiras,
} from '../../../src/modules/carteira/index.js';
import { efeitoDoLancamento, type TipoDeLancamento } from '../../../src/modules/carteira/efeito.js';
import {
  atualizarSaldo,
  inserirLancamento,
  travarSaldo,
} from '../../../src/modules/carteira/repositorio.js';
import { ServicoDeCarteira } from '../../../src/modules/carteira/servico-de-carteira.js';
import { criarLoteELance, type ReferenciaDeLance } from '../../helpers/lance-por-sql.js';
import { BANCO, emailNovo } from '../identidade/ambiente.js';

interface Linhas {
  readonly total: string;
  readonly comprometido: string;
  readonly lancamentos: string;
}

describe.skipIf(!BANCO.disponivel)('interface da carteira para o lance (Postgres real)', () => {
  let banco: BancoVerificavel;
  let pool: pg.Pool;
  let servico: ServicoDeCarteira;
  const criados: string[] = [];

  beforeAll(() => {
    banco = criarBanco({ conexao: BANCO.conexao(), aoErroOcioso: () => undefined });
    // Sem espalhar a conexão: a senha não é propriedade enumerável (não vaza em logs).
    pool = new pg.Pool(BANCO.conexao());
    servico = new ServicoDeCarteira(banco);
  });

  afterAll(async () => {
    await pool.end();
    await banco.encerrar();
  });

  /** Lote e lance reais (committed), pois o ledger tem FK imediata para `lots` e `bids` (D9). */
  const referencia = (): Promise<ReferenciaDeLance> => criarLoteELance(pool);

  async function novoUsuario(depositoCentavos = 0): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `insert into users (nome, email, senha_hash, papel) values ($1, $2, $3, 'licitante')
       returning id`,
      ['Conta de Teste', emailNovo(), 'hash-que-nao-e-usado'],
    );
    const id = rows[0]?.id;
    if (id === undefined) {
      throw new Error('insert em users não devolveu o id');
    }
    criados.push(id);
    if (depositoCentavos > 0) {
      await servico.depositar(id, randomUUID(), depositoCentavos);
    }
    return id;
  }

  async function linhas(userId: string): Promise<Linhas> {
    const { rows } = await pool.query<Linhas>(
      `select coalesce(w.total_centavos, 0)::text as total,
              coalesce(w.comprometido_centavos, 0)::text as comprometido,
              (select count(*) from ledger_entries l where l.user_id = $1)::text as lancamentos
         from (select $1::uuid as id) u
         left join wallet_balances w on w.user_id = u.id`,
      [userId],
    );
    const linha = rows[0];
    if (linha === undefined) {
      throw new Error('consulta de saldo sem linha');
    }
    return linha;
  }

  /** O mesmo caminho que liquidação e cancelamento vão usar (F4), para os tipos sem função ainda. */
  async function lancar(
    tx: Transacao,
    userId: string,
    tipo: TipoDeLancamento,
    valorCentavos: number,
  ): Promise<void> {
    await travarSaldo(tx, userId);
    await inserirLancamento(tx, { userId, tipo, valorCentavos, ...(await referencia()) });
    await atualizarSaldo(tx, userId, efeitoDoLancamento(tipo, valorCentavos));
  }

  describe('comprometer', () => {
    it('reduz o disponível, grava compromisso com lote e lance e devolve o saldo novo', async () => {
      const usuario = await novoUsuario(10_000);
      const ref = await referencia();

      const saldo = await banco.transaction((tx) => comprometer(tx, usuario, 2_500, ref));

      expect(saldo).toEqual({
        totalCentavos: 10_000,
        comprometidoCentavos: 2_500,
        disponivelCentavos: 7_500,
      });
      const { rows } = await pool.query<{
        tipo: string;
        valor: string;
        lote: string;
        lance: string;
      }>(
        `select tipo, valor_centavos::text as valor, lote_id as lote, lance_id as lance
           from ledger_entries where user_id = $1 and tipo = 'compromisso'`,
        [usuario],
      );
      expect(rows).toEqual([
        { tipo: 'compromisso', valor: '2500', lote: ref.loteId, lance: ref.lanceId },
      ]);
    });

    it('comprometer todo o disponível é aceito (limite exato)', async () => {
      const usuario = await novoUsuario(1_000);
      const ref = await referencia();

      const saldo = await banco.transaction((tx) => comprometer(tx, usuario, 1_000, ref));

      expect(saldo.disponivelCentavos).toBe(0);
    });

    it('disponível < valor → ErroDeCarteira e nada é gravado', async () => {
      const usuario = await novoUsuario(1_000);
      const [primeira, segunda] = [await referencia(), await referencia()];
      await banco.transaction((tx) => comprometer(tx, usuario, 600, primeira));
      const antes = await linhas(usuario);

      const tentativa = banco.transaction((tx) => comprometer(tx, usuario, 401, segunda));

      await expect(tentativa).rejects.toBeInstanceOf(ErroDeCarteira);
      await expect(tentativa).rejects.toMatchObject({
        codigo: 'SALDO_INSUFICIENTE',
        disponivel: 400,
        valor: 401,
      });
      expect(await linhas(usuario)).toEqual(antes);
    });

    it('usuário sem carteira (nenhum lançamento) → ErroDeCarteira', async () => {
      const usuario = await novoUsuario();
      const ref = await referencia();

      await expect(
        banco.transaction((tx) => comprometer(tx, usuario, 1, ref)),
      ).rejects.toMatchObject({ codigo: 'SALDO_INSUFICIENTE', disponivel: 0 });
    });

    it('concorrentes no mesmo usuário ficam em fila pelo FOR UPDATE: só um cabe', async () => {
      const usuario = await novoUsuario(1_000);
      const refs = await Promise.all(Array.from({ length: 5 }, referencia));

      const resultados = await Promise.allSettled(
        refs.map((ref) => banco.transaction((tx) => comprometer(tx, usuario, 700, ref))),
      );

      expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const recusas = resultados.filter((r) => r.status === 'rejected');
      expect(recusas).toHaveLength(4);
      for (const recusa of recusas) {
        expect((recusa as PromiseRejectedResult).reason).toBeInstanceOf(ErroDeCarteira);
      }
      expect(await linhas(usuario)).toMatchObject({ total: '1000', comprometido: '700' });
    });
  });

  describe('liberar', () => {
    it('devolve o disponível e grava liberacao na mesma transação do compromisso', async () => {
      const usuario = await novoUsuario(5_000);
      const ref = await referencia();

      const saldo = await banco.transaction(async (tx) => {
        await comprometer(tx, usuario, 3_000, ref);
        return liberar(tx, usuario, 3_000, ref);
      });

      expect(saldo).toEqual({
        totalCentavos: 5_000,
        comprometidoCentavos: 0,
        disponivelCentavos: 5_000,
      });
      const { rows } = await pool.query<{ tipo: string }>(
        `select tipo from ledger_entries where user_id = $1 order by criado_em, id`,
        [usuario],
      );
      expect(rows.map((r) => r.tipo)).toEqual(['deposito', 'compromisso', 'liberacao']);
    });

    it('rollback da transação desfaz compromisso e saldo juntos', async () => {
      const usuario = await novoUsuario(5_000);
      const antes = await linhas(usuario);
      const ref = await referencia();

      await expect(
        banco.transaction(async (tx) => {
          await comprometer(tx, usuario, 1_000, ref);
          throw new Error('falha depois do compromisso');
        }),
      ).rejects.toThrow('falha depois do compromisso');

      expect(await linhas(usuario)).toEqual(antes);
    });

    it('liberar mais que o comprometido → ErroDeCarteira e nada é gravado', async () => {
      const usuario = await novoUsuario(5_000);
      const [primeira, segunda] = [await referencia(), await referencia()];
      await banco.transaction((tx) => comprometer(tx, usuario, 1_000, primeira));
      const antes = await linhas(usuario);

      await expect(
        banco.transaction((tx) => liberar(tx, usuario, 1_001, segunda)),
      ).rejects.toMatchObject({ codigo: 'COMPROMETIDO_INSUFICIENTE', comprometido: 1_000 });
      expect(await linhas(usuario)).toEqual(antes);
    });
  });

  describe('lançamento repetido do mesmo lance (tarefa 093)', () => {
    /** Confere a recusa sem o erro cru do driver: nem em `cause`, nem na mensagem. */
    async function esperarLanceJaProcessado(tentativa: Promise<unknown>): Promise<void> {
      const erro: unknown = await tentativa.then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(erro).toBeInstanceOf(ErroDeCarteira);
      expect(erro).toMatchObject({ codigo: 'LANCE_JA_PROCESSADO', valor: undefined });
      expect((erro as Error).cause).toBeUndefined();
      expect((erro as Error).message).not.toMatch(/23505|duplicate|ledger_entries|Key \(/);
    }

    it('segundo comprometer com o mesmo lanceId → LANCE_JA_PROCESSADO e saldo igual', async () => {
      const usuario = await novoUsuario(10_000);
      const ref = await referencia();
      await banco.transaction((tx) => comprometer(tx, usuario, 2_500, ref));
      const antes = await linhas(usuario);

      await esperarLanceJaProcessado(
        banco.transaction((tx) => comprometer(tx, usuario, 2_500, ref)),
      );

      expect(await linhas(usuario)).toEqual(antes);
    });

    it('segunda liberar com o mesmo lanceId → LANCE_JA_PROCESSADO e saldo igual', async () => {
      const usuario = await novoUsuario(10_000);
      const ref = await referencia();
      await banco.transaction(async (tx) => {
        await comprometer(tx, usuario, 4_000, await referencia());
        await liberar(tx, usuario, 1_000, ref);
      });
      const antes = await linhas(usuario);

      await esperarLanceJaProcessado(banco.transaction((tx) => liberar(tx, usuario, 1_000, ref)));

      expect(await linhas(usuario)).toEqual(antes);
    });

    it('repetição na mesma transação desfaz tudo (o erro exige rollback)', async () => {
      const usuario = await novoUsuario(10_000);
      const ref = await referencia();
      const antes = await linhas(usuario);

      await esperarLanceJaProcessado(
        banco.transaction(async (tx) => {
          await comprometer(tx, usuario, 1_000, ref);
          await comprometer(tx, usuario, 1_000, ref);
        }),
      );

      expect(await linhas(usuario)).toEqual(antes);
    });
  });

  describe('travarCarteiras (D12)', () => {
    it('devolve o saldo de cada carteira, inclusive de quem não tem linha ainda', async () => {
      const comSaldo = await novoUsuario(1_234);
      const semLinha = await novoUsuario();

      const saldos = await banco.transaction((tx) => travarCarteiras(tx, [semLinha, comSaldo]));

      expect(saldos.get(comSaldo)).toEqual({ total: 1_234, comprometido: 0 });
      expect(saldos.get(semLinha)).toEqual({ total: 0, comprometido: 0 });
    });

    it('pares em ordem inversa, em paralelo, não entram em deadlock', async () => {
      const a = await novoUsuario(10_000);
      const b = await novoUsuario(10_000);

      // Cada transação pede as duas carteiras em ordem diferente e segura a trava um pouco.
      const rodada = (primeiro: string, segundo: string): Promise<void> =>
        banco.transaction(async (tx) => {
          await travarCarteiras(tx, [primeiro, segundo]);
          await tx.execute(sql`select pg_sleep(0.05)`);
          await comprometer(tx, primeiro, 10, await referencia());
          await liberar(tx, primeiro, 10, await referencia());
        });

      const resultados = await Promise.allSettled(
        Array.from({ length: 6 }, (_, i) => (i % 2 === 0 ? rodada(a, b) : rodada(b, a))),
      );

      expect(resultados.map((r) => r.status)).toEqual(Array(6).fill('fulfilled'));
    });

    it('trava em ordem crescente de user_id: a segunda carteira espera a primeira', async () => {
      // Linhas já criadas e confirmadas: o INSERT ... ON CONFLICT de travarSaldo não trava nada.
      const [menor, maior] = [await novoUsuario(100), await novoUsuario(100)].sort();
      if (menor === undefined || maior === undefined) {
        throw new Error('usuários não criados');
      }
      const ordem: string[] = [];
      const cliente = await pool.connect();
      try {
        // Outra sessão segura a carteira menor; travarCarteiras([maior, menor]) precisa parar
        // nela antes de tocar a maior, que então continua livre para um NOWAIT.
        await cliente.query('begin');
        await cliente.query('select 1 from wallet_balances where user_id = $1 for update', [menor]);

        const travando = banco.transaction(async (tx) => {
          await travarCarteiras(tx, [maior, menor]);
          ordem.push('travou');
        });
        await new Promise((resolve) => setTimeout(resolve, 200));

        const sonda = await pool.connect();
        try {
          await sonda.query('begin');
          await sonda.query('select 1 from wallet_balances where user_id = $1 for update nowait', [
            maior,
          ]);
          ordem.push('maior livre');
          await sonda.query('rollback');
        } finally {
          sonda.release();
        }

        await cliente.query('commit');
        await travando;
      } finally {
        cliente.release();
      }

      expect(ordem).toEqual(['maior livre', 'travou']);
    });
  });

  describe('reconciliação dos 6 tipos (RNF-02, nota da 039)', () => {
    it('projeção == Σ ledger e 0 ≤ comprometido ≤ total após todos os tipos', async () => {
      const licitante = await novoUsuario(20_000);
      const leiloeiro = await novoUsuario();
      await banco.transaction(async (tx) => {
        await travarCarteiras(tx, [licitante, leiloeiro]);
        await comprometer(tx, licitante, 5_000, await referencia());
        await liberar(tx, licitante, 2_000, await referencia());
        await lancar(tx, licitante, 'estorno', 1_000);
        await lancar(tx, licitante, 'debito_arremate', 1_500);
        await lancar(tx, leiloeiro, 'credito_arremate', 1_500);
      });

      const { rows } = await pool.query<{ tipo: string }>(
        `select distinct tipo::text as tipo from ledger_entries where user_id = any($1::uuid[])`,
        [[licitante, leiloeiro]],
      );
      expect(rows.map((r) => r.tipo).sort()).toEqual([
        'compromisso',
        'credito_arremate',
        'debito_arremate',
        'deposito',
        'estorno',
        'liberacao',
      ]);
      expect(await linhas(licitante)).toMatchObject({ total: '18500', comprometido: '500' });
      expect(await linhas(leiloeiro)).toMatchObject({ total: '1500', comprometido: '0' });

      const { rows: divergentes } = await pool.query(
        `select u.id
           from unnest($1::uuid[]) as u(id)
           left join wallet_balances w on w.user_id = u.id
           left join lateral (
             select coalesce(sum(case l.tipo when 'deposito' then l.valor_centavos
                                             when 'credito_arremate' then l.valor_centavos
                                             when 'debito_arremate' then -l.valor_centavos
                                             else 0 end), 0) as total,
                    coalesce(sum(case l.tipo when 'compromisso' then l.valor_centavos
                                             when 'liberacao' then -l.valor_centavos
                                             when 'estorno' then -l.valor_centavos
                                             when 'debito_arremate' then -l.valor_centavos
                                             else 0 end), 0) as comprometido
               from ledger_entries l where l.user_id = u.id
           ) s on true
          where coalesce(w.total_centavos, 0) <> s.total
             or coalesce(w.comprometido_centavos, 0) <> s.comprometido
             or coalesce(w.comprometido_centavos, 0) < 0
             or coalesce(w.comprometido_centavos, 0) > coalesce(w.total_centavos, 0)`,
        [criados],
      );

      expect(criados.length).toBeGreaterThan(0);
      expect(divergentes).toEqual([]);
    });
  });
});
