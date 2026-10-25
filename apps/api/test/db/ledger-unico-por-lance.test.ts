// Integração (Postgres real): migration 0004 (tarefa 092, specs/004). Índice único parcial
// `ledger_entries_lance_id_tipo_unico`: no máximo um `compromisso` e uma `liberacao` por lance.
// Lote, lance e usuário são reais e committed (FKs imediatas da 0003, D9 da ADR 0031); os
// lançamentos de cada teste ficam numa transação desfeita. A conferência com o snapshot do
// drizzle-kit e o migrate do zero e repetido estão em restricoes-snapshot.test.ts e migrate.test.ts.
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { criarLoteELance, type ReferenciaDeLance } from '../helpers/lance-por-sql.js';
import { inserirUsuario } from '../helpers/lotes-por-sql.js';
import { ambienteDeTeste } from './ambiente-de-teste.js';

const AMBIENTE = ambienteDeTeste(process.env);

const INDICE = 'ledger_entries_lance_id_tipo_unico';
const UNICIDADE = '23505';
const VALOR = 500;

const DEFINICAO_DO_INDICE =
  `CREATE UNIQUE INDEX ${INDICE} ON public.ledger_entries USING btree (lance_id, tipo) ` +
  `WHERE ((tipo = ANY (ARRAY['compromisso'::tipo_lancamento, 'liberacao'::tipo_lancamento])) ` +
  `AND (lance_id IS NOT NULL))`;

type Tipo =
  'deposito' | 'compromisso' | 'liberacao' | 'estorno' | 'debito_arremate' | 'credito_arremate';

interface Lancamento {
  readonly userId: string;
  readonly tipo: Tipo;
  readonly loteId: string | null;
  readonly lanceId: string | null;
}

interface Falha {
  readonly codigo: string | undefined;
  readonly restricao: string | undefined;
}

const INSERIR = `insert into ledger_entries (user_id, tipo, valor_centavos, lote_id, lance_id)
                 values ($1, $2, $3, $4, $5)`;

describe.skipIf(!AMBIENTE.disponivel)(
  'migration 0004: um compromisso e uma liberação por lance',
  () => {
    let pool: pg.Pool;
    let usuarioId: string;

    beforeAll(async () => {
      pool = new pg.Pool(AMBIENTE.conexao());
      usuarioId = (await inserirUsuario(pool, 'licitante')).id;
    });

    afterAll(async () => {
      await pool.end();
    });

    async function emTransacao(fn: (cliente: pg.PoolClient) => Promise<void>): Promise<void> {
      const cliente = await pool.connect();
      try {
        await cliente.query('begin');
        await fn(cliente);
      } finally {
        await cliente.query('rollback').catch(() => undefined);
        cliente.release();
      }
    }

    async function inserir(cliente: pg.PoolClient, l: Lancamento): Promise<void> {
      await cliente.query(INSERIR, [l.userId, l.tipo, VALOR, l.loteId, l.lanceId]);
    }

    /** Insere num savepoint e devolve SQLSTATE e restrição da falha (falha o teste se passar). */
    async function falhaAoInserir(cliente: pg.PoolClient, l: Lancamento): Promise<Falha> {
      await cliente.query('savepoint tentativa');
      try {
        await inserir(cliente, l);
      } catch (erro: unknown) {
        await cliente.query('rollback to savepoint tentativa');
        if (erro instanceof pg.DatabaseError) {
          return { codigo: erro.code, restricao: erro.constraint };
        }
        throw erro;
      }
      throw new Error(`o INSERT de ${l.tipo} deveria ter falhado`);
    }

    async function contar(cliente: pg.PoolClient, lanceId: string): Promise<number> {
      const { rows } = await cliente.query<{ n: string }>(
        'select count(*) as n from ledger_entries where lance_id = $1',
        [lanceId],
      );
      return Number(rows[0]?.n);
    }

    const lancamento = (ref: ReferenciaDeLance, tipo: Tipo): Lancamento => ({
      userId: usuarioId,
      tipo,
      loteId: ref.loteId,
      lanceId: ref.lanceId,
    });

    it('o índice existe com a definição esperada (único, parcial)', async () => {
      const { rows } = await pool.query<{ indexdef: string }>(
        `select indexdef from pg_indexes
        where schemaname = 'public' and tablename = 'ledger_entries' and indexname = $1`,
        [INDICE],
      );

      expect(rows.map((r) => r.indexdef)).toEqual([DEFINICAO_DO_INDICE]);
    });

    it.each(['compromisso', 'liberacao'] as const)(
      'o segundo %s do mesmo lance falha com 23505 pelo nome do índice',
      async (tipo) => {
        const ref = await criarLoteELance(pool);
        await emTransacao(async (cliente) => {
          await inserir(cliente, lancamento(ref, tipo));

          // Mesmo lance e tipo, mesmo de outro usuário: a regra é por lance.
          const outro = (await inserirUsuario(pool, 'licitante')).id;
          expect(await falhaAoInserir(cliente, lancamento(ref, tipo))).toEqual({
            codigo: UNICIDADE,
            restricao: INDICE,
          });
          expect(
            await falhaAoInserir(cliente, { ...lancamento(ref, tipo), userId: outro }),
          ).toEqual({ codigo: UNICIDADE, restricao: INDICE });
          expect(await contar(cliente, ref.lanceId)).toBe(1);
        });
      },
    );

    it('compromisso e liberacao do mesmo lance convivem', async () => {
      const ref = await criarLoteELance(pool);
      await emTransacao(async (cliente) => {
        await inserir(cliente, lancamento(ref, 'compromisso'));
        await inserir(cliente, lancamento(ref, 'liberacao'));

        expect(await contar(cliente, ref.lanceId)).toBe(2);
      });
    });

    it('o mesmo tipo em lances diferentes não conflita', async () => {
      const [a, b] = await Promise.all([criarLoteELance(pool), criarLoteELance(pool)]);
      await emTransacao(async (cliente) => {
        await inserir(cliente, lancamento(a, 'compromisso'));
        await inserir(cliente, lancamento(b, 'compromisso'));
        await inserir(cliente, lancamento(a, 'liberacao'));
        await inserir(cliente, lancamento(b, 'liberacao'));
      });
    });

    it.each(['deposito', 'estorno', 'debito_arremate', 'credito_arremate'] as const)(
      '%s repetido com o mesmo lance_id não é afetado',
      async (tipo) => {
        const ref = await criarLoteELance(pool);
        await emTransacao(async (cliente) => {
          await inserir(cliente, lancamento(ref, tipo));
          await inserir(cliente, lancamento(ref, tipo));

          expect(await contar(cliente, ref.lanceId)).toBe(2);
        });
      },
    );

    it.each(['compromisso', 'liberacao'] as const)(
      '%s sem lance_id não é afetado (várias linhas aceitas)',
      async (tipo) => {
        await emTransacao(async (cliente) => {
          const semLance: Lancamento = { userId: usuarioId, tipo, loteId: null, lanceId: null };
          await inserir(cliente, semLance);
          await inserir(cliente, semLance);

          const { rows } = await cliente.query<{ n: string }>(
            `select count(*) as n from ledger_entries
            where user_id = $1 and tipo = $2 and lance_id is null`,
            [usuarioId, tipo],
          );
          expect(Number(rows[0]?.n)).toBe(2);
        });
      },
    );
  },
);
