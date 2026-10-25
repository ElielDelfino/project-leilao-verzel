// Concorrência de lances e reconciliação do ledger (tarefa 088; specs/007 §Transação, ADR 0031
// D5 e D12). Postgres e Redis reais, pelo POST /api/lotes/{id}/lances. Cada disputa termina com as
// mesmas conferências: seq contígua, um líder, cadeia íntegra pela verificação pura, um lançamento
// por lance, `comprometido` igual ao lance do líder e ≤ `total`, ledger reconciliado. Nenhuma
// resposta pode ser 5xx: só 201, 200 (repetição) e as recusas 422 que a disputa explica.
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import type { LightMyRequestResponse } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { efeitoDoLancamento, TIPOS_DE_LANCAMENTO } from '../../src/modules/carteira/efeito.js';
import { registrarChaveDeAssinatura } from '../../src/modules/lances/index.js';
import { inserirUsuario } from '../helpers/lotes-por-sql.js';
import {
  type AppDeIdentidade,
  BANCO,
  criarAppDeIdentidade,
  INFRA_DISPONIVEL,
} from '../modules/identidade/ambiente.js';
import {
  type ApoioDeLances,
  type Conta,
  criarApoioDeLances,
  erro,
  INCREMENTO_CENTAVOS,
  LANCE_INICIAL_CENTAVOS,
} from './apoio-de-lances.js';
import { divergenciasDaCarteira, TIPOS_TRATADOS_PELO_SQL } from './reconciliacao.js';

const LICITANTES = 50;
const REPETICOES = 20;
const REPETICOES_DE_IDEMPOTENCIA = 5;
const TIMEOUT_MS = 120_000;
const ESPERA_DO_BLOQUEIO_MS = 10_000;
const SONDA_DO_BLOQUEIO_MS = 25;
const RECUSAS_DA_DISPUTA = ['LANCE_ABAIXO_DO_MINIMO', 'JA_ESTA_GANHANDO'];

interface PedidoDeLance {
  readonly conta: Conta;
  readonly valorCentavos: number;
}

/** Conexões externas que seguram o FOR UPDATE de lotes; `soltar` confirma todas juntas. */
interface LotesSegurados {
  /** `pg_backend_pid()` de cada conexão, na ordem dos lotes. */
  readonly pids: readonly number[];
  soltar(): Promise<void>;
}

/** Evita unhandled rejection se a promessa falhar enquanto ninguém a aguarda ainda. */
function semRejeicaoSolta<T>(promessa: Promise<T>): Promise<T> {
  promessa.catch(() => undefined);
  return promessa;
}

function percentil(medidas: readonly number[], p: number): number {
  const ordenadas = [...medidas].sort((a, b) => a - b);
  const indice = Math.min(ordenadas.length - 1, Math.ceil(p * ordenadas.length) - 1);
  return ordenadas[Math.max(0, indice)] ?? 0;
}

describe.skipIf(!INFRA_DISPONIVEL)('lances simultâneos (Postgres e Redis reais)', () => {
  let ctx: AppDeIdentidade;
  let pool: pg.Pool;
  let apoio: ApoioDeLances;

  beforeAll(async () => {
    ctx = await criarAppDeIdentidade();
    await registrarChaveDeAssinatura(ctx.app);
    pool = new pg.Pool(BANCO.conexao());
    const leiloeiro = await inserirUsuario(pool, 'leiloeiro');
    apoio = criarApoioDeLances(ctx, pool, leiloeiro.id);
  });

  afterAll(async () => {
    // O beforeAll pode ter falhado no meio: fecha o que existir, mesmo se um fechamento falhar.
    const poolAberto = pool as pg.Pool | undefined;
    const appAberto = ctx as AppDeIdentidade | undefined;
    try {
      await poolAberto?.end();
    } finally {
      await appAberto?.fechar();
    }
  });

  /** Sessões presas, direta ou indiretamente (fila do lock), atrás de cada `pid` segurador. */
  async function sessoesPresasPorSegurador(pids: readonly number[]): Promise<Map<number, number>> {
    const { rows } = await pool.query<{ raiz: number; n: string }>(
      `with recursive presas(pid, raiz) as (
         select a.pid, h.pid
           from pg_stat_activity a cross join unnest($1::int[]) as h(pid)
          where a.datname = current_database() and h.pid = any(pg_blocking_pids(a.pid))
         union
         select a.pid, p.raiz
           from pg_stat_activity a join presas p on p.pid = any(pg_blocking_pids(a.pid))
          where a.datname = current_database()
       )
       select raiz, count(distinct pid)::text as n from presas group by raiz`,
      [pids],
    );
    return new Map(rows.map((linha) => [linha.raiz, Number(linha.n)]));
  }

  /**
   * Espera até `minimo` sessões presas atrás de CADA `pid` segurador (as requisições paradas no
   * FOR UPDATE daquele lote). Só conta sessões bloqueadas pelas nossas conexões: o que outro
   * arquivo de teste fizer no mesmo banco não satisfaz a espera.
   */
  async function aguardarPresas(minimos: ReadonlyMap<number, number>): Promise<void> {
    const pids = [...minimos.keys()];
    const limite = Date.now() + ESPERA_DO_BLOQUEIO_MS;
    for (;;) {
      const presas = await sessoesPresasPorSegurador(pids);
      if (pids.every((pid) => (presas.get(pid) ?? 0) >= (minimos.get(pid) ?? 0))) return;
      if (Date.now() > limite) {
        const visto = pids.map((pid) => `${pid}=${presas.get(pid) ?? 0}`).join(' ');
        throw new Error(
          `requisições não ficaram presas nos locks (presas por segurador: ${visto})`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, SONDA_DO_BLOQUEIO_MS));
    }
  }

  /**
   * Segura o FOR UPDATE dos lotes, cada um numa conexão externa, e roda `acao`. Em qualquer saída
   * sem `soltar` as transações são desfeitas (`allSettled`) e toda conexão é devolvida ao pool,
   * como quebrada (`release(err)`) se o rollback falhou. Se um `connect()` falhar, as já abertas
   * são soltas.
   */
  async function comLotesSegurados<T>(
    loteIds: readonly string[],
    acao: (segurados: LotesSegurados) => Promise<T>,
  ): Promise<T> {
    const clientes: pg.PoolClient[] = [];
    let confirmadas = false;
    try {
      const pids: number[] = [];
      for (const loteId of loteIds) {
        const cliente = await pool.connect();
        clientes.push(cliente);
        await cliente.query('begin');
        await cliente.query('select id from lots where id = $1 for update', [loteId]);
        const { rows } = await cliente.query<{ pid: number }>('select pg_backend_pid() as pid');
        pids.push(rows[0]?.pid as number);
      }
      return await acao({
        pids,
        soltar: async () => {
          await Promise.all(clientes.map((cliente) => cliente.query('commit')));
          confirmadas = true;
        },
      });
    } finally {
      const quebradas = new Map<pg.PoolClient, Error | true>();
      if (!confirmadas) {
        const desfeitas = await Promise.allSettled(clientes.map((c) => c.query('rollback')));
        desfeitas.forEach((desfeita, i) => {
          if (desfeita.status === 'rejected') {
            const motivo: unknown = desfeita.reason;
            quebradas.set(clientes[i] as pg.PoolClient, motivo instanceof Error ? motivo : true);
          }
        });
      }
      for (const cliente of clientes) cliente.release(quebradas.get(cliente));
    }
  }

  /**
   * Segura o lote, dispara os lances na ordem dada, esperando cada um ficar preso na fila do lock
   * antes de disparar o próximo (a ordem de chegada no FOR UPDATE é a da lista), e solta. Devolve
   * as respostas na ordem da lista.
   */
  async function lancarEmOrdemComLoteSegurado(
    loteId: string,
    pedidos: readonly PedidoDeLance[],
  ): Promise<LightMyRequestResponse[]> {
    const disparados: Promise<LightMyRequestResponse>[] = [];
    try {
      return await comLotesSegurados([loteId], async ({ pids, soltar }) => {
        const segurador = pids[0] as number;
        for (const [i, pedido] of pedidos.entries()) {
          disparados.push(
            semRejeicaoSolta(apoio.lancar(pedido.conta, loteId, pedido.valorCentavos)),
          );
          await aguardarPresas(new Map([[segurador, i + 1]]));
        }
        await soltar();
        return Promise.all(disparados);
      });
    } finally {
      // Se algo falhou, o rollback já soltou o lote: espera as requisições terminarem.
      await Promise.allSettled(disparados);
    }
  }

  describe('50 licitantes no mesmo lote', () => {
    it(
      'seq contígua, um líder, cadeia íntegra e carteiras reconciliadas',
      async () => {
        const contas = await apoio.licitantesComSaldo(LICITANTES);
        const loteId = await apoio.lote();
        const medidas: number[] = [];

        const respostas = await Promise.all(
          contas.map(async (conta, i) => {
            const inicio = performance.now();
            const resposta = await apoio.lancar(
              conta,
              loteId,
              LANCE_INICIAL_CENTAVOS + i * INCREMENTO_CENTAVOS,
            );
            medidas.push(performance.now() - inicio);
            return resposta;
          }),
        );

        const aceitas = respostas.filter((r) => r.statusCode === 201);
        const recusas = respostas.filter((r) => r.statusCode !== 201);
        for (const recusa of recusas) {
          expect(recusa.statusCode).toBe(422);
          expect(RECUSAS_DA_DISPUTA).toContain(erro(recusa).codigo);
        }
        const lances = await apoio.conferirLote(loteId);
        expect(aceitas.length).toBeGreaterThanOrEqual(1);
        expect(lances).toHaveLength(aceitas.length);
        // Cada 201 devolveu o seq que ficou gravado para aquele licitante.
        const seqPorLicitante = new Map(lances.map((l) => [l.licitanteId, l.seq]));
        expect(seqPorLicitante.size).toBe(lances.length);
        respostas.forEach((resposta, i) => {
          const conta = contas[i] as Conta;
          if (resposta.statusCode !== 201) {
            expect(seqPorLicitante.has(conta.id)).toBe(false);
            return;
          }
          const { dados } = resposta.json() as { dados: { lance: { seq: number } } };
          expect(dados.lance.seq).toBe(seqPorLicitante.get(conta.id));
        });
        // Σ comprometido = lance do líder; zero nas demais.
        const lider = lances.at(-1);
        await apoio.conferirCarteiras(
          contas,
          new Map(lider === undefined ? [] : [[lider.licitanteId, lider.valorCentavos]]),
        );

        // Relatório (sem asserção rígida; o gate de p95 é do k6 na F5). Inclui a fila do pool
        // de 10 conexões do servidor, sem rede (inject).
        console.info(
          `[088] ${LICITANTES} lances simultâneos no mesmo lote: aceitos=${aceitas.length} ` +
            `recusados=${recusas.length} p50=${percentil(medidas, 0.5).toFixed(0)} ms ` +
            `p95=${percentil(medidas, 0.95).toFixed(0)} ms max=${Math.max(...medidas).toFixed(0)} ms`,
        );
      },
      TIMEOUT_MS,
    );
  });

  describe('o líder anterior dá o próximo lance enquanto outro disputa', () => {
    // A lidera o lote com 1000. O lote é segurado por uma conexão externa; A (1300) e B (1100)
    // chegam na ordem do caso e ficam na fila do FOR UPDATE; ao soltar, a ordem de atendimento é
    // a de chegada. Nada depende de probabilidade.
    it(
      'A (líder) chega antes de B: A recebe JA_ESTA_GANHANDO e B lidera',
      async () => {
        const [a, b] = (await apoio.licitantesComSaldo(2)) as [Conta, Conta];
        await ctx.resetarLimite();
        const loteId = await apoio.lote();
        expect((await apoio.lancar(a, loteId, 1000)).statusCode).toBe(201);

        const [deA, deB] = (await lancarEmOrdemComLoteSegurado(loteId, [
          { conta: a, valorCentavos: 1300 },
          { conta: b, valorCentavos: 1100 },
        ])) as [LightMyRequestResponse, LightMyRequestResponse];

        expect(deA.statusCode).toBe(422);
        expect(erro(deA).codigo).toBe('JA_ESTA_GANHANDO');
        expect(deB.statusCode).toBe(201);
        const lances = await apoio.conferirLote(loteId);
        expect(lances.map((l) => [l.licitanteId, l.valorCentavos])).toEqual([
          [a.id, 1000],
          [b.id, 1100],
        ]);
        // O 1000 de A foi liberado; só o 1100 de B segue comprometido.
        await apoio.conferirCarteiras([a, b], new Map([[b.id, 1100]]));
      },
      TIMEOUT_MS,
    );

    it(
      'B chega antes de A (líder): A deixa de ser líder, retoma com 1300 e lidera de novo',
      async () => {
        const [a, b] = (await apoio.licitantesComSaldo(2)) as [Conta, Conta];
        await ctx.resetarLimite();
        const loteId = await apoio.lote();
        expect((await apoio.lancar(a, loteId, 1000)).statusCode).toBe(201);

        const [deB, deA] = (await lancarEmOrdemComLoteSegurado(loteId, [
          { conta: b, valorCentavos: 1100 },
          { conta: a, valorCentavos: 1300 },
        ])) as [LightMyRequestResponse, LightMyRequestResponse];

        expect(deB.statusCode).toBe(201);
        expect(deA.statusCode).toBe(201);
        const lances = await apoio.conferirLote(loteId);
        expect(lances.map((l) => [l.licitanteId, l.valorCentavos])).toEqual([
          [a.id, 1000],
          [b.id, 1100],
          [a.id, 1300],
        ]);
        // A em dois papéis (líder anterior e novo líder): só o 1300 comprometido; B voltou a zero.
        await apoio.conferirCarteiras([a, b], new Map([[a.id, 1300]]));
      },
      TIMEOUT_MS,
    );
  });

  describe('lotes cruzados (D12)', () => {
    it(
      `X lidera o lote 2, Y o lote 1; lotes segurados e soltos juntos, ${REPETICOES} vezes`,
      async () => {
        const [x, y] = (await apoio.licitantesComSaldo(2)) as [Conta, Conta];
        const lotes: string[] = [];

        for (let i = 0; i < REPETICOES; i++) {
          await ctx.resetarLimite();
          const [lote1, lote2] = [await apoio.lote(), await apoio.lote()];
          lotes.push(lote1, lote2);
          expect((await apoio.lancar(y, lote1, 1000)).statusCode).toBe(201);
          expect((await apoio.lancar(x, lote2, 1000)).statusCode).toBe(201);

          // Conexões externas seguram o FOR UPDATE dos dois lotes; os dois lances cruzados ficam
          // presos em `travarLote` (esperamos uma requisição presa atrás de CADA conexão nossa) e
          // acordam no mesmo instante, quando as duas confirmam juntas.
          const disparados: Promise<LightMyRequestResponse>[] = [];
          try {
            const respostas = await comLotesSegurados([lote1, lote2], async ({ pids, soltar }) => {
              disparados.push(
                semRejeicaoSolta(apoio.lancar(x, lote1, 1100)),
                semRejeicaoSolta(apoio.lancar(y, lote2, 1100)),
              );
              await aguardarPresas(new Map(pids.map((pid) => [pid, 1])));
              await soltar();
              return Promise.all(disparados);
            });
            // Nenhum 503 (55P03 ou 40P01 traduzidos) nem 500.
            expect(respostas.map((r) => r.statusCode)).toEqual([201, 201]);
          } finally {
            // Se algo falhou, o rollback já soltou os lotes: espera as requisições terminarem.
            await Promise.allSettled(disparados);
          }
        }

        for (const loteId of lotes) {
          const lances = await apoio.conferirLote(loteId);
          expect(lances).toHaveLength(2);
        }
        // Em cada repetição X lidera o lote 1 e Y o lote 2, ambos com 1100.
        const comprometido = REPETICOES * 1100;
        await apoio.conferirCarteiras(
          [x, y],
          new Map([
            [x.id, comprometido],
            [y.id, comprometido],
          ]),
        );
      },
      TIMEOUT_MS,
    );
  });

  describe('Idempotency-Key repetida em paralelo (ADR 0031 D5)', () => {
    it(
      'mesma chave em dois lotes: um 201 e um 422 DADOS_INVALIDOS, sem efeito no outro lote',
      async () => {
        for (let i = 0; i < REPETICOES_DE_IDEMPOTENCIA; i++) {
          const [conta] = (await apoio.licitantesComSaldo(1)) as [Conta];
          const [lote1, lote2] = [await apoio.lote(), await apoio.lote()];
          const chave = randomUUID();

          const respostas = await Promise.all([
            apoio.lancar(conta, lote1, 1000, chave),
            apoio.lancar(conta, lote2, 1000, chave),
          ]);

          expect(respostas.map((r) => r.statusCode).sort()).toEqual([201, 422]);
          const recusada = respostas.find((r) => r.statusCode === 422);
          expect(erro(recusada as NonNullable<typeof recusada>).codigo).toBe('DADOS_INVALIDOS');
          const gravados = [await apoio.conferirLote(lote1), await apoio.conferirLote(lote2)].map(
            (lances) => lances.length,
          );
          expect(gravados.sort()).toEqual([0, 1]);
          await apoio.conferirCarteiras([conta], new Map([[conta.id, 1000]]));
        }
      },
      TIMEOUT_MS,
    );

    it(
      'mesma chave no mesmo lote: um 201 e um 200 com o lance original',
      async () => {
        for (let i = 0; i < REPETICOES_DE_IDEMPOTENCIA; i++) {
          const [conta] = (await apoio.licitantesComSaldo(1)) as [Conta];
          const loteId = await apoio.lote();
          const chave = randomUUID();

          const respostas = await Promise.all([
            apoio.lancar(conta, loteId, 1000, chave),
            apoio.lancar(conta, loteId, 1000, chave),
          ]);

          expect(respostas.map((r) => r.statusCode).sort()).toEqual([200, 201]);
          const [criada, repetida] = [201, 200].map(
            (status) => respostas.find((r) => r.statusCode === status) as (typeof respostas)[0],
          ) as [(typeof respostas)[0], (typeof respostas)[0]];
          const lanceDe = (r: typeof criada): unknown =>
            (r.json() as { dados: { lance: unknown } }).dados.lance;
          expect(lanceDe(repetida)).toEqual(lanceDe(criada));
          expect(await apoio.conferirLote(loteId)).toHaveLength(1);
          await apoio.conferirCarteiras([conta], new Map([[conta.id, 1000]]));
        }
      },
      TIMEOUT_MS,
    );
  });
});

describe.skipIf(!INFRA_DISPONIVEL)('reconciliação do ledger: o SQL cobre os tipos', () => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = new pg.Pool(BANCO.conexao());
  });

  afterAll(async () => {
    await pool.end();
  });

  /**
   * Roda `fn` numa transação com cópias TEMPORÁRIAS de `ledger_entries` e `wallet_balances`
   * (o schema temporário vem primeiro no search_path, então o SQL de reconciliação as lê), com
   * `tipo` em texto para poder provar o que o enum não deixa inserir. Sempre desfeita.
   */
  async function comTabelasTemporarias(
    fn: (cliente: pg.PoolClient) => Promise<void>,
  ): Promise<void> {
    const cliente = await pool.connect();
    try {
      await cliente.query('begin');
      await cliente.query(
        'create temp table ledger_entries (user_id uuid, tipo text, valor_centavos bigint) on commit drop',
      );
      await cliente.query(
        `create temp table wallet_balances
           (user_id uuid, total_centavos bigint, comprometido_centavos bigint) on commit drop`,
      );
      await fn(cliente);
    } finally {
      await cliente.query('rollback');
      cliente.release();
    }
  }

  it('o enum tipo_lancamento tem exatamente os tipos que o SQL trata', async () => {
    const { rows } = await pool.query<{ tipo: string }>(
      'select unnest(enum_range(null::tipo_lancamento))::text as tipo',
    );

    expect(rows.map((r) => r.tipo).sort()).toEqual([...TIPOS_TRATADOS_PELO_SQL].sort());
    expect([...TIPOS_DE_LANCAMENTO].sort()).toEqual([...TIPOS_TRATADOS_PELO_SQL].sort());
  });

  it.each(TIPOS_TRATADOS_PELO_SQL)(
    '%s: a soma do SQL concorda com efeitoDoLancamento (e uma projeção errada diverge)',
    async (tipo) => {
      const efeito = efeitoDoLancamento(tipo as (typeof TIPOS_DE_LANCAMENTO)[number], 500);
      await comTabelasTemporarias(async (cliente) => {
        const { rows } = await cliente.query<{ id: string }>(
          'select gen_random_uuid()::text as id',
        );
        const userId = rows[0]?.id;
        await cliente.query('insert into ledger_entries values ($1, $2, 500)', [userId, tipo]);
        await cliente.query('insert into wallet_balances values ($1, $2, $3)', [
          userId,
          efeito.total,
          efeito.comprometido,
        ]);
        expect(await divergenciasDaCarteira(cliente)).toEqual([]);

        await cliente.query('update wallet_balances set comprometido_centavos = $1', [
          efeito.comprometido + 1,
        ]);
        expect(await divergenciasDaCarteira(cliente)).toHaveLength(1);
      });
    },
  );

  it('tipo sem efeito no SQL falha alto, citando o tipo, em vez de somar 0', async () => {
    await comTabelasTemporarias(async (cliente) => {
      await cliente.query(
        `insert into ledger_entries values (gen_random_uuid(), 'bonus_inesperado', 500)`,
      );

      await expect(divergenciasDaCarteira(cliente)).rejects.toThrow(
        /tipo sem efeito no SQL: bonus_inesperado/,
      );
    });
  });
});
