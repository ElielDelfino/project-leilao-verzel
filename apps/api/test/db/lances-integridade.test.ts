// Integração (Postgres real): migration 0003 (tarefa 073). bids (specs/007 §Dados), lot_seals e
// signing_keys (specs/008 §Dados, ADR 0031): índices, CHECKs, uniques, FKs (inclusive as do
// ledger, D9), triggers append-only e privilégios do papel da API (ADR 0026). Os dois triggers de
// cada tabela e a matriz de tabela estão em papeis.test.ts. Cada teste numa transação desfeita.
import { createHash, randomBytes, randomUUID } from 'node:crypto';

import pg from 'pg';
import { describe, expect, it } from 'vitest';

import { COMANDO_LOCK_TIMEOUT, repetirEmDisputaDeLock } from '../helpers/disputa-de-lock.js';
import { TIMEOUT_LONGO_MS } from '../helpers/timeouts.js';
import { ambienteDeTeste } from './ambiente-de-teste.js';

const AMBIENTE = ambienteDeTeste(process.env);

const PAPEL_DA_API = 'leilao_api';
const TABELAS = ['bids', 'lot_seals', 'signing_keys'] as const;
const MAXIMO = String(Number.MAX_SAFE_INTEGER);
const ACIMA_DO_MAXIMO = (BigInt(Number.MAX_SAFE_INTEGER) + 1n).toString();

const SQLSTATE = {
  semPrivilegio: '42501',
  appendOnly: '23001',
  check: '23514',
  unicidade: '23505',
  fk: '23503',
  naoNulo: '23502',
} as const;

async function emTransacao(fn: (cliente: pg.Client) => Promise<void>): Promise<void> {
  const cliente = new pg.Client(AMBIENTE.conexao());
  await cliente.connect();
  try {
    await cliente.query('begin');
    await fn(cliente);
  } finally {
    await cliente.query('rollback').catch(() => undefined);
    await cliente.end();
  }
}

/** Roda o comando num savepoint e devolve o SQLSTATE da falha (ou falha o teste se ele passar). */
async function codigoDaFalha(
  cliente: pg.Client,
  comando: string,
  parametros: readonly unknown[] = [],
): Promise<string | undefined> {
  await cliente.query('savepoint tentativa');
  try {
    await cliente.query(comando, [...parametros]);
  } catch (erro: unknown) {
    await cliente.query('rollback to savepoint tentativa');
    if (erro instanceof pg.DatabaseError) {
      return erro.code;
    }
    throw erro;
  }
  throw new Error(`o comando deveria ter falhado: ${comando}`);
}

/** SQLSTATE do TRUNCATE de `lista` numa transação própria, repetida em disputa de lock. */
async function codigoDoComandoComLock(lista: string): Promise<string | undefined> {
  return repetirEmDisputaDeLock(`truncate ${lista}`, async () => {
    let codigo: string | undefined;
    await emTransacao(async (cliente) => {
      await cliente.query(COMANDO_LOCK_TIMEOUT);
      codigo = await codigoDaFalha(cliente, `truncate ${lista}`);
    });
    return codigo;
  });
}

async function idDe(cliente: pg.Client, comando: string, parametros: unknown[]): Promise<string> {
  const { rows } = await cliente.query<{ id: string }>(comando, parametros);
  return String(rows[0]?.id);
}

async function criarUsuario(cliente: pg.Client, papel = 'licitante'): Promise<string> {
  return idDe(
    cliente,
    `insert into users (nome, email, senha_hash, papel) values ('Helena', $1, 'h', $2) returning id`,
    [`${randomUUID()}@teste.local`, papel],
  );
}

async function criarLote(cliente: pg.Client): Promise<string> {
  const leiloeiro = await criarUsuario(cliente, 'leiloeiro');
  const snapshot = await idDe(
    cliente,
    `insert into card_snapshots (scryfall_id, nome, colecao, raridade, tipo, dados, imagem,
       imagem_mime, imagem_sha256)
     values ($1, 'Black Lotus', 'Alpha', 'rare', 'Artifact', '{}', '\\xff', 'image/jpeg', $2)
     returning id`,
    [randomUUID(), Buffer.alloc(32, 7)],
  );
  return idDe(
    cliente,
    `insert into lots (leiloeiro_id, snapshot_id, carta_nome, raridade, titulo,
       lance_inicial_centavos, incremento_minimo_centavos, inicio_em, fim_em, fim_original_em,
       status)
     values ($1, $2, 'Black Lotus', 'rare', 'Lotus', 100, 100, now(), now() + interval '1 hour',
             now() + interval '1 hour', 'ao_vivo')
     returning id`,
    [leiloeiro, snapshot],
  );
}

/** Uma chave pública qualquer de 32 bytes e o key_id derivado dela (specs/008 §Chaves). */
function chaveNova(): { keyId: string; chave: Buffer } {
  const chave = randomBytes(32);
  return { keyId: createHash('sha256').update(chave).digest('hex').slice(0, 16), chave };
}

const INSERIR_CHAVE = `insert into signing_keys (key_id, chave_publica) values ($1, $2)
  on conflict (key_id) do nothing`;

async function registrarChave(cliente: pg.Client): Promise<string> {
  const { keyId, chave } = chaveNova();
  await cliente.query(INSERIR_CHAVE, [keyId, chave]);
  return keyId;
}

interface Contexto {
  readonly lote: string;
  readonly licitante: string;
  readonly keyId: string;
}

async function criarContexto(cliente: pg.Client): Promise<Contexto> {
  return {
    lote: await criarLote(cliente),
    licitante: await criarUsuario(cliente),
    keyId: await registrarChave(cliente),
  };
}

const COLUNAS_DO_LANCE = [
  'lote_id',
  'seq',
  'licitante_id',
  'pseudonimo',
  'valor_centavos',
  'criado_em',
  'hash_anterior',
  'hash',
  'assinatura',
  'key_id',
  'idempotency_key',
] as const;

type Lance = Record<(typeof COLUNAS_DO_LANCE)[number], unknown>;

const INSERIR_LANCE = `insert into bids (${COLUNAS_DO_LANCE.join(', ')})
  values ($1, $2, $3, $4, $5::bigint, $6, $7, $8, $9, $10, $11) returning id`;

function lance(contexto: Contexto, campos: Partial<Lance> = {}): unknown[] {
  const base: Lance = {
    lote_id: contexto.lote,
    seq: 1,
    licitante_id: contexto.licitante,
    pseudonimo: 'Licitante #3fa9c1',
    valor_centavos: 15_000,
    criado_em: '2026-10-27T14:03:07.120Z',
    hash_anterior: Buffer.alloc(32, 1),
    hash: Buffer.alloc(32, 2),
    assinatura: Buffer.alloc(64, 3),
    key_id: contexto.keyId,
    idempotency_key: randomUUID(),
  };
  const linha = { ...base, ...campos };
  return COLUNAS_DO_LANCE.map((coluna) => linha[coluna]);
}

/** Pseudônimo do vetor de teste da specs/008 §Técnica. */
const PSEUDONIMO_DO_VETOR = 'Licitante #3fa9c1';

/** Vazio, curto, longo, maiúscula, prefixo errado e espaço sobrando: todos dão 23514. */
const PSEUDONIMOS_INVALIDOS = [
  '',
  'Licitante #3fa9c',
  'Licitante #3fa9c10',
  'Licitante #3FA9C1',
  'licitante #3fa9c1',
  'Licitante 3fa9c1',
  'Bidder #3fa9c1',
  ' Licitante #3fa9c1',
  'Licitante #3fa9c1\n',
] as const;

const COLUNAS_DO_SELO = [
  'lote_id',
  'status',
  'total_lances',
  'hash_final',
  'vencedor_pseudonimo',
  'valor_arremate_centavos',
  'selado_em',
  'assinatura',
  'key_id',
] as const;

type Selo = Record<(typeof COLUNAS_DO_SELO)[number], unknown>;

/** Nulas em lote cancelado ou sem lance (specs/008 §Forma canônica); as demais são NOT NULL. */
const COLUNAS_NULAVEIS_DO_SELO: ReadonlySet<string> = new Set([
  'vencedor_pseudonimo',
  'valor_arremate_centavos',
]);

const INSERIR_SELO = `insert into lot_seals (${COLUNAS_DO_SELO.join(', ')})
  values ($1, $2, $3, $4, $5, $6::bigint, $7, $8, $9)`;

function selo(contexto: Contexto, campos: Partial<Selo> = {}): unknown[] {
  const base: Selo = {
    lote_id: contexto.lote,
    status: 'encerrado',
    total_lances: 2,
    hash_final: Buffer.alloc(32, 4),
    vencedor_pseudonimo: 'Licitante #b04e7d',
    valor_arremate_centavos: 16_500,
    selado_em: '2026-10-27T15:00:00.000Z',
    assinatura: Buffer.alloc(64, 5),
    key_id: contexto.keyId,
  };
  const linha = { ...base, ...campos };
  return COLUNAS_DO_SELO.map((coluna) => linha[coluna]);
}

describe.skipIf(!AMBIENTE.disponivel)('migration 0003: estrutura', () => {
  it('bids: uniques (lote_id, seq) e (licitante_id, idempotency_key) e índice de me/lances', async () => {
    await emTransacao(async (cliente) => {
      const { rows } = await cliente.query<{ nome: string; definicao: string }>(
        `select indexname as nome, indexdef as definicao from pg_indexes
          where schemaname = 'public' and tablename = 'bids' order by indexname`,
      );
      const definicoes = Object.fromEntries(rows.map((linha) => [linha.nome, linha.definicao]));

      expect(Object.keys(definicoes)).toEqual([
        'bids_licitante_id_idempotency_key_unique',
        'bids_licitante_id_lote_id_idx',
        'bids_lote_id_seq_unique',
        'bids_pkey',
      ]);
      expect(definicoes['bids_lote_id_seq_unique']).toContain('UNIQUE INDEX');
      expect(definicoes['bids_lote_id_seq_unique']).toContain('(lote_id, seq)');
      expect(definicoes['bids_licitante_id_idempotency_key_unique']).toContain(
        '(licitante_id, idempotency_key)',
      );
      expect(definicoes['bids_licitante_id_lote_id_idx']).toContain('(licitante_id, lote_id)');
    });
  });

  it('criado_em, selado_em e ativa_desde guardam milissegundos (timestamptz(3))', async () => {
    await emTransacao(async (cliente) => {
      const { rows } = await cliente.query(
        `select table_name as tabela, column_name as coluna, datetime_precision as precisao
           from information_schema.columns
          where table_schema = 'public' and data_type = 'timestamp with time zone'
            and table_name = any($1) order by 1, 2`,
        [TABELAS],
      );

      expect(rows).toEqual([
        { tabela: 'bids', coluna: 'criado_em', precisao: 3 },
        { tabela: 'lot_seals', coluna: 'selado_em', precisao: 3 },
        { tabela: 'signing_keys', coluna: 'ativa_desde', precisao: 3 },
      ]);
    });
  });
});

describe.skipIf(!AMBIENTE.disponivel)('migration 0003: privilégios do papel da API', () => {
  it('como leilao_api: registra a chave, grava lance e ledger (D9) e sela; tudo legível', async () => {
    await emTransacao(async (cliente) => {
      const lote = await criarLote(cliente);
      const licitante = await criarUsuario(cliente);
      await cliente.query(`set local role ${PAPEL_DA_API}`);
      const keyId = await registrarChave(cliente);
      const contexto = { lote, licitante, keyId };

      const lanceId = await idDe(cliente, INSERIR_LANCE, lance(contexto));
      await cliente.query(
        `insert into ledger_entries (user_id, tipo, valor_centavos, lote_id, lance_id)
         values ($1, 'deposito', 15000, null, null), ($1, 'compromisso', 15000, $2, $3)`,
        [licitante, lote, lanceId],
      );
      await cliente.query(INSERIR_SELO, selo(contexto, { total_lances: 1 }));

      const { rows } = await cliente.query(
        `select b.seq, s.total_lances, k.key_id = b.key_id as mesma_chave
           from bids b join lot_seals s using (lote_id) join signing_keys k on k.key_id = s.key_id
          where b.id = $1`,
        [lanceId],
      );
      expect(rows).toEqual([{ seq: 1, total_lances: 1, mesma_chave: true }]);
    });
  });

  it('como leilao_api: reiniciar com a mesma chave não cria linha nem muda ativa_desde', async () => {
    await emTransacao(async (cliente) => {
      await cliente.query(`set local role ${PAPEL_DA_API}`);
      const { keyId, chave } = chaveNova();
      await cliente.query(INSERIR_CHAVE, [keyId, chave]);
      const antes = await cliente.query('select ativa_desde from signing_keys where key_id = $1', [
        keyId,
      ]);

      const repetido = await cliente.query(INSERIR_CHAVE, [keyId, chave]);

      const depois = await cliente.query('select ativa_desde from signing_keys where key_id = $1', [
        keyId,
      ]);
      expect(repetido.rowCount).toBe(0);
      expect(depois.rows).toEqual(antes.rows);
    });
  });

  it.each(TABELAS)(
    'como leilao_api: UPDATE de cada coluna, DELETE e TRUNCATE em %s dão 42501',
    async (tabela) => {
      await emTransacao(async (cliente) => {
        const { rows } = await cliente.query<{ coluna: string }>(
          `select column_name as coluna from information_schema.columns
            where table_schema = 'public' and table_name = $1 order by ordinal_position`,
          [tabela],
        );
        expect(rows.length).toBeGreaterThan(0);
        await cliente.query(`set local role ${PAPEL_DA_API}`);

        for (const { coluna } of rows) {
          expect(
            await codigoDaFalha(cliente, `update ${tabela} set ${coluna} = ${coluna}`),
            coluna,
          ).toBe(SQLSTATE.semPrivilegio);
        }
        expect(await codigoDaFalha(cliente, `delete from ${tabela}`)).toBe(SQLSTATE.semPrivilegio);
        expect(await codigoDaFalha(cliente, `truncate ${tabela}`)).toBe(SQLSTATE.semPrivilegio);
      });
    },
  );
});

describe.skipIf(!AMBIENTE.disponivel)('migration 0003: append-only até para o dono', () => {
  it('UPDATE e DELETE de uma linha existente dão 23001 nas três tabelas', async () => {
    await emTransacao(async (cliente) => {
      const contexto = await criarContexto(cliente);
      await cliente.query(INSERIR_LANCE, lance(contexto));
      await cliente.query(INSERIR_SELO, selo(contexto));

      for (const [tabela, atribuicao] of [
        ['bids', 'valor_centavos = valor_centavos + 100'],
        ['lot_seals', 'total_lances = total_lances + 1'],
        ['signing_keys', 'ativa_desde = ativa_desde'],
      ] as const) {
        expect(await codigoDaFalha(cliente, `update ${tabela} set ${atribuicao}`), tabela).toBe(
          SQLSTATE.appendOnly,
        );
        expect(await codigoDaFalha(cliente, `delete from ${tabela}`), tabela).toBe(
          SQLSTATE.appendOnly,
        );
      }
    });
  });

  // Causa da instabilidade: o comando pede ACCESS EXCLUSIVE antes de o trigger recusar, e outros
  // arquivos escrevendo nas mesmas tabelas travam (55P03) ou entram em deadlock (40P01) com ele.
  it(
    'TRUNCATE dá 23001 (com as tabelas que as referenciam, para passar da checagem de FK)',
    async () => {
      for (const [lista, esperado] of [
        ['lot_seals', SQLSTATE.appendOnly],
        ['bids, ledger_entries', SQLSTATE.appendOnly],
        // receipts.key_id também referencia signing_keys (migration 0005, tarefa 102).
        ['signing_keys, bids, lot_seals, ledger_entries, receipts', SQLSTATE.appendOnly],
        // Sozinhas, bids e signing_keys param antes, na checagem de FK (feature_not_supported).
        ['bids', '0A000'],
        ['signing_keys', '0A000'],
      ] as const) {
        expect(await codigoDoComandoComLock(lista), lista).toBe(esperado);
      }
    },
    TIMEOUT_LONGO_MS,
  );
});

describe.skipIf(!AMBIENTE.disponivel)('migration 0003: restrições de bids', () => {
  it('seq ≥ 1 e valor de 100 a 2^53 − 1', async () => {
    await emTransacao(async (cliente) => {
      const contexto = await criarContexto(cliente);

      for (const campos of [
        { seq: 0 },
        { seq: -1 },
        { valor_centavos: 99 },
        { valor_centavos: 0 },
        { valor_centavos: ACIMA_DO_MAXIMO },
      ]) {
        expect(await codigoDaFalha(cliente, INSERIR_LANCE, lance(contexto, campos))).toBe(
          SQLSTATE.check,
        );
      }
      await cliente.query(INSERIR_LANCE, lance(contexto, { seq: 1, valor_centavos: 100 }));
      await cliente.query(INSERIR_LANCE, lance(contexto, { seq: 2, valor_centavos: MAXIMO }));
    });
  });

  it('hashes com 32 bytes, assinatura com 64 e key_id com 16 hex minúsculos', async () => {
    await emTransacao(async (cliente) => {
      const contexto = await criarContexto(cliente);

      for (const campos of [
        { hash_anterior: Buffer.alloc(31) },
        { hash_anterior: Buffer.alloc(33) },
        { hash: Buffer.alloc(31) },
        { hash: Buffer.alloc(64) },
        { assinatura: Buffer.alloc(63) },
        { assinatura: Buffer.alloc(65) },
        { key_id: contexto.keyId.toUpperCase() },
        { key_id: contexto.keyId.slice(1) },
        { key_id: `${contexto.keyId}0` },
      ]) {
        expect(await codigoDaFalha(cliente, INSERIR_LANCE, lance(contexto, campos))).toBe(
          SQLSTATE.check,
        );
      }
    });
  });

  it('pseudônimo só no formato "Licitante #" + 6 hex minúsculos (specs/008)', async () => {
    await emTransacao(async (cliente) => {
      const contexto = await criarContexto(cliente);

      for (const pseudonimo of PSEUDONIMOS_INVALIDOS) {
        expect(await codigoDaFalha(cliente, INSERIR_LANCE, lance(contexto, { pseudonimo }))).toBe(
          SQLSTATE.check,
        );
      }
      await cliente.query(INSERIR_LANCE, lance(contexto, { pseudonimo: PSEUDONIMO_DO_VETOR }));
    });
  });

  it.each(COLUNAS_DO_LANCE)(
    '%s nulo dá 23502 (o CHECK sozinho deixaria NULL passar)',
    async (coluna) => {
      await emTransacao(async (cliente) => {
        const contexto = await criarContexto(cliente);

        expect(
          await codigoDaFalha(cliente, INSERIR_LANCE, lance(contexto, { [coluna]: null })),
        ).toBe(SQLSTATE.naoNulo);
      });
    },
  );

  it('seq repetida no lote e chave de idempotência repetida no licitante dão 23505', async () => {
    await emTransacao(async (cliente) => {
      const contexto = await criarContexto(cliente);
      const chave = randomUUID();
      await cliente.query(INSERIR_LANCE, lance(contexto, { seq: 1, idempotency_key: chave }));

      expect(await codigoDaFalha(cliente, INSERIR_LANCE, lance(contexto, { seq: 1 }))).toBe(
        SQLSTATE.unicidade,
      );
      expect(
        await codigoDaFalha(
          cliente,
          INSERIR_LANCE,
          lance(contexto, { seq: 2, idempotency_key: chave }),
        ),
      ).toBe(SQLSTATE.unicidade);
      // A chave é por licitante, não por lote: repeti-la em outro lote também dá 23505.
      const outroLote = await criarLote(cliente);
      expect(
        await codigoDaFalha(
          cliente,
          INSERIR_LANCE,
          lance(contexto, { seq: 1, lote_id: outroLote, idempotency_key: chave }),
        ),
      ).toBe(SQLSTATE.unicidade);
      // A mesma seq em outro lote e a mesma chave para outro licitante entram.
      await cliente.query(INSERIR_LANCE, lance(contexto, { seq: 1, lote_id: outroLote }));
      await cliente.query(
        INSERIR_LANCE,
        lance(contexto, {
          seq: 2,
          licitante_id: await criarUsuario(cliente),
          idempotency_key: chave,
        }),
      );
    });
  });

  it('lote, licitante e key_id precisam existir', async () => {
    await emTransacao(async (cliente) => {
      const contexto = await criarContexto(cliente);

      for (const campos of [
        { lote_id: randomUUID() },
        { licitante_id: randomUUID() },
        { key_id: chaveNova().keyId },
      ]) {
        expect(await codigoDaFalha(cliente, INSERIR_LANCE, lance(contexto, campos))).toBe(
          SQLSTATE.fk,
        );
      }
    });
  });
});

describe.skipIf(!AMBIENTE.disponivel)('migration 0003: restrições de lot_seals', () => {
  it('status, total, tamanhos, key_id e faixa do arremate', async () => {
    await emTransacao(async (cliente) => {
      const contexto = await criarContexto(cliente);

      for (const campos of [
        { status: 'ao_vivo' },
        { status: 'ENCERRADO' },
        { total_lances: -1 },
        { hash_final: Buffer.alloc(31) },
        { assinatura: Buffer.alloc(32) },
        { key_id: 'z'.repeat(16) },
        { valor_arremate_centavos: 99 },
        { valor_arremate_centavos: ACIMA_DO_MAXIMO },
      ]) {
        expect(await codigoDaFalha(cliente, INSERIR_SELO, selo(contexto, campos))).toBe(
          SQLSTATE.check,
        );
      }
      await cliente.query(INSERIR_SELO, selo(contexto, { valor_arremate_centavos: MAXIMO }));
    });
  });

  it('vencedor e arremate só juntos e só em lote encerrado com lance (NULL não escapa)', async () => {
    await emTransacao(async (cliente) => {
      const contexto = await criarContexto(cliente);
      const semVencedor = { vencedor_pseudonimo: null, valor_arremate_centavos: null };

      for (const campos of [
        { vencedor_pseudonimo: null },
        { valor_arremate_centavos: null },
        { status: 'encerrado', ...semVencedor },
        { status: 'encerrado', total_lances: 0 },
        { status: 'cancelado' },
        { status: 'cancelado', total_lances: 0 },
      ]) {
        expect(await codigoDaFalha(cliente, INSERIR_SELO, selo(contexto, campos))).toBe(
          SQLSTATE.check,
        );
      }
      const lotes = [await criarLote(cliente), await criarLote(cliente)];
      await cliente.query(
        INSERIR_SELO,
        selo(contexto, { lote_id: lotes[0], status: 'encerrado', total_lances: 0, ...semVencedor }),
      );
      await cliente.query(
        INSERIR_SELO,
        selo(contexto, { lote_id: lotes[1], status: 'cancelado', total_lances: 3, ...semVencedor }),
      );
      await cliente.query(INSERIR_SELO, selo(contexto));
    });
  });

  it('vencedor_pseudonimo no formato da specs/008; NULL só em lote sem vencedor', async () => {
    await emTransacao(async (cliente) => {
      const contexto = await criarContexto(cliente);

      for (const vencedor_pseudonimo of PSEUDONIMOS_INVALIDOS) {
        expect(
          await codigoDaFalha(cliente, INSERIR_SELO, selo(contexto, { vencedor_pseudonimo })),
        ).toBe(SQLSTATE.check);
      }
      const semVencedor = await criarLote(cliente);
      await cliente.query(
        INSERIR_SELO,
        selo(contexto, {
          lote_id: semVencedor,
          status: 'cancelado',
          vencedor_pseudonimo: null,
          valor_arremate_centavos: null,
        }),
      );
      await cliente.query(
        INSERIR_SELO,
        selo(contexto, { vencedor_pseudonimo: PSEUDONIMO_DO_VETOR }),
      );
    });
  });

  it.each(COLUNAS_DO_SELO.filter((coluna) => !COLUNAS_NULAVEIS_DO_SELO.has(coluna)))(
    '%s nulo dá 23502',
    async (coluna) => {
      await emTransacao(async (cliente) => {
        const contexto = await criarContexto(cliente);

        expect(await codigoDaFalha(cliente, INSERIR_SELO, selo(contexto, { [coluna]: null }))).toBe(
          SQLSTATE.naoNulo,
        );
      });
    },
  );

  it('um selo por lote; lote e key_id precisam existir', async () => {
    await emTransacao(async (cliente) => {
      const contexto = await criarContexto(cliente);
      await cliente.query(INSERIR_SELO, selo(contexto));

      expect(await codigoDaFalha(cliente, INSERIR_SELO, selo(contexto))).toBe(SQLSTATE.unicidade);
      expect(
        await codigoDaFalha(cliente, INSERIR_SELO, selo(contexto, { lote_id: randomUUID() })),
      ).toBe(SQLSTATE.fk);
      expect(
        await codigoDaFalha(
          cliente,
          INSERIR_SELO,
          selo(contexto, { lote_id: await criarLote(cliente), key_id: chaveNova().keyId }),
        ),
      ).toBe(SQLSTATE.fk);
    });
  });
});

describe.skipIf(!AMBIENTE.disponivel)('migration 0003: restrições de signing_keys', () => {
  it('chave de 32 bytes; key_id derivado dela, em hex minúsculo; nulos dão 23502', async () => {
    await emTransacao(async (cliente) => {
      const { keyId, chave } = chaveNova();
      const inserir = 'insert into signing_keys (key_id, chave_publica) values ($1, $2)';

      for (const [id, bytes] of [
        [keyId, chave.subarray(0, 31)],
        [keyId, Buffer.concat([chave, Buffer.alloc(1)])],
        [keyId.toUpperCase(), chave],
        [chaveNova().keyId, chave],
        [keyId.slice(0, 15), chave],
      ] as const) {
        expect(await codigoDaFalha(cliente, inserir, [id, bytes])).toBe(SQLSTATE.check);
      }
      expect(await codigoDaFalha(cliente, inserir, [null, chave])).toBe(SQLSTATE.naoNulo);
      expect(await codigoDaFalha(cliente, inserir, [keyId, null])).toBe(SQLSTATE.naoNulo);
      expect(
        await codigoDaFalha(
          cliente,
          'insert into signing_keys (key_id, chave_publica, ativa_desde) values ($1, $2, null)',
          [keyId, chave],
        ),
      ).toBe(SQLSTATE.naoNulo);
      await cliente.query(inserir, [keyId, chave]);
    });
  });
});

describe.skipIf(!AMBIENTE.disponivel)('migration 0003: FKs do ledger (D9 da ADR 0031)', () => {
  it('ledger_entries.lote_id e lance_id precisam existir; nulos continuam aceitos', async () => {
    await emTransacao(async (cliente) => {
      const contexto = await criarContexto(cliente);
      const lanceId = await idDe(cliente, INSERIR_LANCE, lance(contexto));
      const inserir = `insert into ledger_entries (user_id, tipo, valor_centavos, lote_id, lance_id)
                       values ($1, 'compromisso', 100, $2, $3)`;

      expect(
        await codigoDaFalha(cliente, inserir, [contexto.licitante, randomUUID(), lanceId]),
      ).toBe(SQLSTATE.fk);
      expect(
        await codigoDaFalha(cliente, inserir, [contexto.licitante, contexto.lote, randomUUID()]),
      ).toBe(SQLSTATE.fk);
      await cliente.query(inserir, [contexto.licitante, contexto.lote, lanceId]);
      await cliente.query(inserir, [contexto.licitante, null, null]);
    });
  });
});
