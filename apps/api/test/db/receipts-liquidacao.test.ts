// Integração (Postgres real): migration 0005 (tarefa 102). `receipts` (specs/010 §Dados, D8):
// restrições, triggers append-only e privilégios do papel da API (ADR 0026); e o índice único
// parcial `ledger_entries_lote_id_tipo_unico` (D4): um estorno, um débito e um crédito de
// arremate por lote. Lote, usuários e chave são reais e committed (FKs imediatas); comprovantes e
// lançamentos ficam numa transação desfeita. A matriz geral e as FKs à mão estão em
// papeis.test.ts e restricoes-snapshot.test.ts.
import { randomBytes } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { COMANDO_LOCK_TIMEOUT, repetirEmDisputaDeLock } from '../helpers/disputa-de-lock.js';
import { TIMEOUT_LONGO_MS } from '../helpers/timeouts.js';
import { criarLoteELance, inserirChaveDeTeste } from '../helpers/lance-por-sql.js';
import { inserirLote, inserirUsuario } from '../helpers/lotes-por-sql.js';
import { ambienteDeTeste } from './ambiente-de-teste.js';

const AMBIENTE = ambienteDeTeste(process.env);

const PAPEL_DA_API = 'leilao_api';
const INDICE_DO_LEDGER = 'ledger_entries_lote_id_tipo_unico';
const INDICE_DO_EXTRATO = 'receipts_vencedor_id_emitido_em_id_idx';

const SQLSTATE = {
  semPrivilegio: '42501',
  appendOnly: '23001',
  check: '23514',
  unicidade: '23505',
} as const;

const DEFINICOES_DOS_INDICES = [
  `CREATE UNIQUE INDEX ${INDICE_DO_LEDGER} ON public.ledger_entries USING btree (lote_id, tipo) ` +
    `WHERE ((tipo = ANY (ARRAY['estorno'::tipo_lancamento, 'debito_arremate'::tipo_lancamento, ` +
    `'credito_arremate'::tipo_lancamento])) AND (lote_id IS NOT NULL))`,
  `CREATE INDEX ${INDICE_DO_EXTRATO} ON public.receipts USING btree ` +
    `(vencedor_id, emitido_em DESC, id DESC)`,
];

type Tipo = 'compromisso' | 'liberacao' | 'estorno' | 'debito_arremate' | 'credito_arremate';

interface Falha {
  readonly codigo: string | undefined;
  readonly restricao: string | undefined;
  readonly mensagem: string;
}

interface Comprovante {
  readonly loteId: string;
  readonly codigo: string;
  readonly vencedorId: string;
  readonly pseudonimo: string;
  readonly valor: number;
  readonly hashFinal: Buffer;
  readonly assinatura: Buffer;
  readonly keyId: string;
}

const INSERIR_COMPROVANTE = `insert into receipts (lote_id, codigo_publico, vencedor_id,
    vencedor_pseudonimo, valor_centavos, hash_final, assinatura_selo, key_id, selado_em)
  values ($1, $2, $3, $4, $5::bigint, $6, $7, $8, now()) returning id, emitido_em`;

const INSERIR_LANCAMENTO = `insert into ledger_entries (user_id, tipo, valor_centavos, lote_id)
                            values ($1, $2, 500, $3)`;

const ALFABETO_BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const CARACTERES_DO_CODIGO = 16;

function codigoNovo(): string {
  return Array.from(randomBytes(CARACTERES_DO_CODIGO), (b) => ALFABETO_BASE62[b % 62]).join('');
}

/** Roda o comando num savepoint e devolve a falha (ou falha o teste se ele passar). */
async function falhaDe(
  cliente: pg.PoolClient,
  comando: string,
  parametros: readonly unknown[] = [],
): Promise<Falha> {
  await cliente.query('savepoint tentativa');
  try {
    await cliente.query(comando, [...parametros]);
  } catch (erro: unknown) {
    await cliente.query('rollback to savepoint tentativa');
    if (erro instanceof pg.DatabaseError) {
      return { codigo: erro.code, restricao: erro.constraint, mensagem: erro.message };
    }
    throw erro;
  }
  throw new Error(`o comando deveria ter falhado: ${comando}`);
}

describe.skipIf(!AMBIENTE.disponivel)('migration 0005: receipts e unicidade por lote', () => {
  let pool: pg.Pool;
  let leiloeiroId: string;
  let vencedorId: string;
  let keyId: string;

  beforeAll(async () => {
    pool = new pg.Pool(AMBIENTE.conexao());
    leiloeiroId = (await inserirUsuario(pool, 'leiloeiro')).id;
    vencedorId = (await inserirUsuario(pool, 'licitante')).id;
    keyId = await inserirChaveDeTeste(pool);
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

  async function comprovanteNovo(): Promise<Comprovante> {
    const lote = await inserirLote(pool, leiloeiroId);
    return {
      loteId: lote.id,
      codigo: codigoNovo(),
      vencedorId,
      pseudonimo: 'Licitante #0a1b2c',
      valor: 12_345,
      hashFinal: randomBytes(32),
      assinatura: randomBytes(64),
      keyId,
    };
  }

  const parametros = (c: Comprovante): unknown[] => [
    c.loteId,
    c.codigo,
    c.vencedorId,
    c.pseudonimo,
    c.valor,
    c.hashFinal,
    c.assinatura,
    c.keyId,
  ];

  it('os dois índices da migration existem com a definição esperada', async () => {
    const { rows } = await pool.query<{ indexdef: string }>(
      `select indexdef from pg_indexes
        where schemaname = 'public' and indexname = any($1) order by indexname`,
      [[INDICE_DO_LEDGER, INDICE_DO_EXTRATO]],
    );

    expect(rows.map((r) => r.indexdef)).toEqual(DEFINICOES_DOS_INDICES);
  });

  it('receipts liga os dois triggers, habilitados, com impedir_alteracao()', async () => {
    const { rows } = await pool.query<{ nome: string; tipo: number; habilitado: boolean }>(
      `select tgname as nome, tgtype::int as tipo, tgenabled = 'O' as habilitado
         from pg_trigger
        where tgrelid = 'public.receipts'::regclass and not tgisinternal
          and tgfoid = 'public.impedir_alteracao()'::regprocedure
        order by tgname`,
    );

    // tgtype: ROW = 1, BEFORE = 2, DELETE = 8, UPDATE = 16, TRUNCATE = 32.
    expect(rows).toEqual([
      { nome: 'receipts_append_only', tipo: 1 | 2 | 8 | 16, habilitado: true },
      { nome: 'receipts_sem_truncate', tipo: 2 | 32, habilitado: true },
    ]);
  });

  it('como leilao_api: INSERT e SELECT funcionam; emitido_em vem do banco', async () => {
    const c = await comprovanteNovo();
    await emTransacao(async (cliente) => {
      await cliente.query(`set local role ${PAPEL_DA_API}`);
      const inserido = await cliente.query<{ id: string; emitido_em: Date }>(
        INSERIR_COMPROVANTE,
        parametros(c),
      );

      const { rows } = await cliente.query<{ codigo_publico: string; valor_centavos: string }>(
        'select codigo_publico, valor_centavos from receipts where lote_id = $1',
        [c.loteId],
      );
      expect(inserido.rows[0]?.emitido_em).toBeInstanceOf(Date);
      expect(rows).toEqual([{ codigo_publico: c.codigo, valor_centavos: '12345' }]);
    });
  });

  it('como leilao_api: UPDATE de cada coluna, DELETE e TRUNCATE dão 42501', async () => {
    const c = await comprovanteNovo();
    await emTransacao(async (cliente) => {
      await cliente.query(INSERIR_COMPROVANTE, parametros(c));
      const { rows } = await cliente.query<{ coluna: string }>(
        `select column_name as coluna from information_schema.columns
          where table_schema = 'public' and table_name = 'receipts' order by ordinal_position`,
      );
      expect(rows).toHaveLength(11);
      await cliente.query(`set local role ${PAPEL_DA_API}`);
      const negado = { codigo: SQLSTATE.semPrivilegio, restricao: undefined };
      const mensagem = 'permission denied for table receipts';

      for (const { coluna } of rows) {
        expect(await falhaDe(cliente, `update receipts set ${coluna} = ${coluna}`), coluna).toEqual(
          { ...negado, mensagem },
        );
      }
      expect(await falhaDe(cliente, 'delete from receipts')).toEqual({ ...negado, mensagem });
      expect(await falhaDe(cliente, 'truncate receipts')).toEqual({ ...negado, mensagem });
    });
  });

  it(
    'como dono: UPDATE, DELETE e TRUNCATE dão 23001 pelo trigger',
    async () => {
      const c = await comprovanteNovo();
      await emTransacao(async (cliente) => {
        await cliente.query(INSERIR_COMPROVANTE, parametros(c));
        const append = (op: string): Falha => ({
          codigo: SQLSTATE.appendOnly,
          restricao: undefined,
          mensagem: `a tabela receipts é append-only: ${op} não é permitido`,
        });

        expect(
          await falhaDe(cliente, 'update receipts set valor_centavos = 100 where lote_id = $1', [
            c.loteId,
          ]),
        ).toEqual(append('UPDATE'));
        expect(
          await falhaDe(cliente, 'delete from receipts where lote_id = $1', [c.loteId]),
        ).toEqual(append('DELETE'));
      });
      // Em transação própria, sem INSERT antes (RowExclusive → AccessExclusive no mesmo tx é
      // receita de deadlock), com lock_timeout curto e repetição em disputa de lock.
      const codigo = await repetirEmDisputaDeLock('truncate receipts como dono', async () => {
        let obtido: string | undefined;
        await emTransacao(async (cliente) => {
          await cliente.query(COMANDO_LOCK_TIMEOUT);
          obtido = (await falhaDe(cliente, 'truncate receipts')).codigo;
        });
        return obtido;
      });
      expect(codigo).toBe(SQLSTATE.appendOnly);
    },
    TIMEOUT_LONGO_MS,
  );

  it.each([
    ['receipts_codigo_publico_formato', { codigo: 'curto' }],
    ['receipts_codigo_publico_formato', { codigo: 'abcdefgh-1234567' }],
    ['receipts_vencedor_pseudonimo_formato', { pseudonimo: 'Helena Secreta' }],
    ['receipts_valor_faixa', { valor: 99 }],
    ['receipts_valor_faixa', { valor: Number.MAX_SAFE_INTEGER + 1 }],
    ['receipts_hash_final_tamanho', { hashFinal: randomBytes(31) }],
    ['receipts_assinatura_selo_tamanho', { assinatura: randomBytes(63) }],
    ['receipts_key_id_formato', { keyId: 'ABCDEF0123456789' }],
  ] as const)('%s recusa %o com 23514', async (restricao, alteracao) => {
    const c = { ...(await comprovanteNovo()), ...alteracao };
    await emTransacao(async (cliente) => {
      const falha = await falhaDe(cliente, INSERIR_COMPROVANTE, parametros(c));
      expect({ codigo: falha.codigo, restricao: falha.restricao }).toEqual({
        codigo: SQLSTATE.check,
        restricao,
      });
    });
  });

  it('os limites de valor (100 e 2^53 − 1) são aceitos', async () => {
    const [a, b] = await Promise.all([comprovanteNovo(), comprovanteNovo()]);
    await emTransacao(async (cliente) => {
      await cliente.query(INSERIR_COMPROVANTE, parametros({ ...a, valor: 100 }));
      await cliente.query(
        INSERIR_COMPROVANTE,
        parametros({ ...b, valor: Number.MAX_SAFE_INTEGER }),
      );
    });
  });

  it('um comprovante por lote e código público único (23505)', async () => {
    const [a, b] = await Promise.all([comprovanteNovo(), comprovanteNovo()]);
    await emTransacao(async (cliente) => {
      await cliente.query(INSERIR_COMPROVANTE, parametros(a));

      const mesmoLote = await falhaDe(
        cliente,
        INSERIR_COMPROVANTE,
        parametros({ ...a, codigo: codigoNovo() }),
      );
      const mesmoCodigo = await falhaDe(
        cliente,
        INSERIR_COMPROVANTE,
        parametros({ ...b, codigo: a.codigo }),
      );
      expect([mesmoLote.restricao, mesmoCodigo.restricao]).toEqual([
        'receipts_lote_id_unique',
        'receipts_codigo_publico_unique',
      ]);
      expect([mesmoLote.codigo, mesmoCodigo.codigo]).toEqual([
        SQLSTATE.unicidade,
        SQLSTATE.unicidade,
      ]);
    });
  });

  describe('índice único (lote_id, tipo) do ledger', () => {
    async function inserir(
      cliente: pg.PoolClient,
      tipo: Tipo,
      loteId: string | null,
      userId = vencedorId,
    ): Promise<void> {
      await cliente.query(INSERIR_LANCAMENTO, [userId, tipo, loteId]);
    }

    it.each(['estorno', 'debito_arremate', 'credito_arremate'] as const)(
      'o segundo %s do mesmo lote falha com 23505 pelo nome do índice, mesmo de outro usuário',
      async (tipo) => {
        const { loteId } = await criarLoteELance(pool);
        await emTransacao(async (cliente) => {
          await inserir(cliente, tipo, loteId);

          for (const userId of [vencedorId, leiloeiroId]) {
            const falha = await falhaDe(cliente, INSERIR_LANCAMENTO, [userId, tipo, loteId]);
            expect({ codigo: falha.codigo, restricao: falha.restricao }).toEqual({
              codigo: SQLSTATE.unicidade,
              restricao: INDICE_DO_LEDGER,
            });
          }
        });
      },
    );

    it('débito, crédito e estorno do mesmo lote convivem; outro lote não conflita', async () => {
      const [a, b] = await Promise.all([criarLoteELance(pool), criarLoteELance(pool)]);
      await emTransacao(async (cliente) => {
        for (const ref of [a, b]) {
          await inserir(cliente, 'debito_arremate', ref.loteId);
          await inserir(cliente, 'credito_arremate', ref.loteId, leiloeiroId);
          await inserir(cliente, 'estorno', ref.loteId);
        }
      });
    });

    it.each(['compromisso', 'liberacao'] as const)(
      '%s repetido no mesmo lote (sem lance_id) não é afetado',
      async (tipo) => {
        const { loteId } = await criarLoteELance(pool);
        await emTransacao(async (cliente) => {
          await inserir(cliente, tipo, loteId);
          await inserir(cliente, tipo, loteId);
        });
      },
    );

    it.each(['estorno', 'debito_arremate', 'credito_arremate'] as const)(
      '%s sem lote_id não é afetado (várias linhas aceitas)',
      async (tipo) => {
        await emTransacao(async (cliente) => {
          await inserir(cliente, tipo, null);
          await inserir(cliente, tipo, null);
        });
      },
    );
  });
});
