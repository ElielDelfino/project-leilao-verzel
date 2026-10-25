// Integração (Postgres real): migration 0002 (tarefa 051). card_snapshots (specs/005 §Dados) e
// lots (specs/006 §Dados): índices, CHECKs das invariantes de criação, FKs e privilégios do papel
// da API (ADR 0026). Roda no banco de teste do worktree; cada teste numa transação desfeita.
import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { describe, expect, it } from 'vitest';

import { ambienteDeTeste } from './ambiente-de-teste.js';

const AMBIENTE = ambienteDeTeste(process.env);

const PAPEL_DA_API = 'leilao_api';

const SQLSTATE = {
  semPrivilegio: '42501',
  check: '23514',
  unicidade: '23505',
  fk: '23503',
  naoNulo: '23502',
} as const;

/** Abre uma transação, roda `fn` e desfaz tudo. */
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

async function criarLeiloeiro(cliente: pg.Client): Promise<string> {
  const { rows } = await cliente.query<{ id: string }>(
    `insert into users (nome, email, senha_hash, papel)
     values ('Leo', $1, 'hash', 'leiloeiro') returning id`,
    [`${randomUUID()}@teste.local`],
  );
  return String(rows[0]?.id);
}

interface Snapshot {
  readonly sha?: Buffer;
  readonly mime?: string;
}

const INSERIR_SNAPSHOT = `insert into card_snapshots
  (scryfall_id, nome, colecao, raridade, tipo, texto_oracle, artista, dados, imagem, imagem_mime,
   imagem_sha256)
  values ($1, 'Black Lotus', 'Alpha', 'rare', 'Artifact', null, null, '{}'::jsonb, $2, $3, $4)
  returning id`;

function parametrosDoSnapshot({ sha = Buffer.alloc(32, 7), mime = 'image/jpeg' }: Snapshot) {
  return [randomUUID(), Buffer.from([0xff, 0xd8, 0xff]), mime, sha];
}

async function criarSnapshot(cliente: pg.Client): Promise<string> {
  const { rows } = await cliente.query<{ id: string }>(INSERIR_SNAPSHOT, parametrosDoSnapshot({}));
  return String(rows[0]?.id);
}

interface Lote {
  readonly leiloeiro: string;
  readonly snapshot: string;
  readonly lanceInicial?: number | string;
  readonly incremento?: number | string;
  /** Duração original como intervalo do Postgres. */
  readonly duracao?: string;
}

const INSERIR_LOTE = `insert into lots
  (leiloeiro_id, snapshot_id, carta_nome, raridade, titulo, lance_inicial_centavos,
   incremento_minimo_centavos, inicio_em, fim_em, fim_original_em, status)
  values ($1, $2, 'Black Lotus', 'rare', 'Lotus', $3, $4, now(), now() + $5::interval,
          now() + $5::interval, 'ao_vivo')
  returning id`;

function parametrosDoLote(lote: Lote): unknown[] {
  return [
    lote.leiloeiro,
    lote.snapshot,
    lote.lanceInicial ?? 100,
    lote.incremento ?? 100,
    lote.duracao ?? '1 hour',
  ];
}

async function criarLote(cliente: pg.Client, lote: Lote): Promise<string> {
  const { rows } = await cliente.query<{ id: string }>(INSERIR_LOTE, parametrosDoLote(lote));
  return String(rows[0]?.id);
}

describe.skipIf(!AMBIENTE.disponivel)('migration 0002: índices', () => {
  it('lots tem os 5 índices da spec, dois deles trigram (GIN)', async () => {
    await emTransacao(async (cliente) => {
      const { rows } = await cliente.query<{ nome: string; definicao: string }>(
        `select indexname as nome, indexdef as definicao from pg_indexes
          where schemaname = 'public' and tablename = 'lots'
            and indexname not in ('lots_pkey', 'lots_snapshot_id_unique')
          order by indexname`,
      );

      expect(rows.map((linha) => linha.nome)).toEqual([
        'lots_carta_nome_trgm_idx',
        'lots_leiloeiro_id_criado_em_id_idx',
        'lots_status_fim_em_idx',
        'lots_status_inicio_em_idx',
        'lots_titulo_trgm_idx',
      ]);
      const definicoes = Object.fromEntries(rows.map((linha) => [linha.nome, linha.definicao]));
      expect(definicoes['lots_titulo_trgm_idx']).toContain('USING gin (titulo gin_trgm_ops)');
      expect(definicoes['lots_carta_nome_trgm_idx']).toContain(
        'USING gin (carta_nome gin_trgm_ops)',
      );
      expect(definicoes['lots_status_fim_em_idx']).toContain('(status, fim_em)');
      expect(definicoes['lots_status_inicio_em_idx']).toContain('(status, inicio_em)');
      expect(definicoes['lots_leiloeiro_id_criado_em_id_idx']).toContain(
        '(leiloeiro_id, criado_em DESC, id DESC)',
      );
    });
  });
});

describe.skipIf(!AMBIENTE.disponivel)('migration 0002: privilégios do papel da API', () => {
  it('como leilao_api: cria snapshot e lote, lê e altera o lote', async () => {
    await emTransacao(async (cliente) => {
      const leiloeiro = await criarLeiloeiro(cliente);
      await cliente.query(`set local role ${PAPEL_DA_API}`);
      const snapshot = await criarSnapshot(cliente);
      const lote = await criarLote(cliente, { leiloeiro, snapshot });

      await cliente.query(
        `update lots set status = 'cancelado', cancelado_em = now() where id = $1`,
        [lote],
      );
      const { rows } = await cliente.query(
        `select l.status, l.total_lances, s.imagem_mime
           from lots l join card_snapshots s on s.id = l.snapshot_id where l.id = $1`,
        [lote],
      );
      expect(rows).toEqual([{ status: 'cancelado', total_lances: 0, imagem_mime: 'image/jpeg' }]);
    });
  });

  it('como leilao_api: UPDATE e DELETE em card_snapshots e DELETE em lots dão 42501', async () => {
    await emTransacao(async (cliente) => {
      const leiloeiro = await criarLeiloeiro(cliente);
      const snapshot = await criarSnapshot(cliente);
      await criarLote(cliente, { leiloeiro, snapshot });
      await cliente.query(`set local role ${PAPEL_DA_API}`);

      expect(await codigoDaFalha(cliente, `update card_snapshots set nome = 'x'`)).toBe(
        SQLSTATE.semPrivilegio,
      );
      expect(await codigoDaFalha(cliente, 'delete from card_snapshots')).toBe(
        SQLSTATE.semPrivilegio,
      );
      expect(await codigoDaFalha(cliente, 'delete from lots')).toBe(SQLSTATE.semPrivilegio);
      expect(await codigoDaFalha(cliente, 'truncate lots, card_snapshots')).toBe(
        SQLSTATE.semPrivilegio,
      );
    });
  });
});

describe.skipIf(!AMBIENTE.disponivel)('migration 0002: UPDATE por coluna em lots', () => {
  it('como leilao_api: colunas da criação dão 42501; status passa', async () => {
    await emTransacao(async (cliente) => {
      const leiloeiro = await criarLeiloeiro(cliente);
      const lote = await criarLote(cliente, { leiloeiro, snapshot: await criarSnapshot(cliente) });
      await cliente.query(`set local role ${PAPEL_DA_API}`);

      for (const atribuicao of [
        `carta_nome = 'x'`,
        'lance_inicial_centavos = 200',
        "fim_original_em = fim_original_em + interval '1 minute'",
        'leiloeiro_id = leiloeiro_id',
      ]) {
        expect(
          await codigoDaFalha(cliente, `update lots set ${atribuicao} where id = $1`, [lote]),
        ).toBe(SQLSTATE.semPrivilegio);
      }
      await cliente.query(`update lots set status = 'encerrado' where id = $1`, [lote]);
    });
  });
});

describe.skipIf(!AMBIENTE.disponivel)('migration 0002: restrições', () => {
  it('card_snapshots: imagem e imagem_sha256 são NOT NULL', async () => {
    await emTransacao(async (cliente) => {
      const [scryfall, imagem, mime, sha] = parametrosDoSnapshot({});
      expect(await codigoDaFalha(cliente, INSERIR_SNAPSHOT, [scryfall, null, mime, sha])).toBe(
        SQLSTATE.naoNulo,
      );
      expect(await codigoDaFalha(cliente, INSERIR_SNAPSHOT, [scryfall, imagem, mime, null])).toBe(
        SQLSTATE.naoNulo,
      );
    });
  });

  it('card_snapshots: imagem_sha256 precisa ter 32 bytes', async () => {
    await emTransacao(async (cliente) => {
      for (const tamanho of [0, 31, 33]) {
        expect(
          await codigoDaFalha(
            cliente,
            INSERIR_SNAPSHOT,
            parametrosDoSnapshot({ sha: Buffer.alloc(tamanho) }),
          ),
        ).toBe(SQLSTATE.check);
      }
      await cliente.query(INSERIR_SNAPSHOT, parametrosDoSnapshot({ sha: Buffer.alloc(32) }));
    });
  });

  it('card_snapshots: imagem_mime só image/jpeg ou image/png', async () => {
    await emTransacao(async (cliente) => {
      for (const mime of ['text/html', 'image/gif', 'IMAGE/PNG', '']) {
        expect(await codigoDaFalha(cliente, INSERIR_SNAPSHOT, parametrosDoSnapshot({ mime }))).toBe(
          SQLSTATE.check,
        );
      }
      await cliente.query(INSERIR_SNAPSHOT, parametrosDoSnapshot({ mime: 'image/png' }));
    });
  });

  it('lots: lance inicial e incremento de 100 a 100.000.000 centavos', async () => {
    await emTransacao(async (cliente) => {
      const leiloeiro = await criarLeiloeiro(cliente);
      const tentar = async (campos: Partial<Lote>): Promise<string | undefined> =>
        codigoDaFalha(
          cliente,
          INSERIR_LOTE,
          parametrosDoLote({ leiloeiro, snapshot: await criarSnapshot(cliente), ...campos }),
        );

      expect(await tentar({ lanceInicial: 99 })).toBe(SQLSTATE.check);
      expect(await tentar({ lanceInicial: 100_000_001 })).toBe(SQLSTATE.check);
      expect(await tentar({ incremento: 99 })).toBe(SQLSTATE.check);
      expect(await tentar({ incremento: 100_000_001 })).toBe(SQLSTATE.check);
      await criarLote(cliente, {
        leiloeiro,
        snapshot: await criarSnapshot(cliente),
        lanceInicial: 100_000_000,
        incremento: 100_000_000,
      });
    });
  });

  it('lots: duração original de 5 min a 7 dias; fim_em estendido passa de 7 dias', async () => {
    await emTransacao(async (cliente) => {
      const leiloeiro = await criarLeiloeiro(cliente);
      const tentar = async (duracao: string): Promise<string | undefined> =>
        codigoDaFalha(
          cliente,
          INSERIR_LOTE,
          parametrosDoLote({ leiloeiro, snapshot: await criarSnapshot(cliente), duracao }),
        );

      expect(await tentar('299 seconds')).toBe(SQLSTATE.check);
      expect(await tentar('7 days 1 second')).toBe(SQLSTATE.check);
      await criarLote(cliente, {
        leiloeiro,
        snapshot: await criarSnapshot(cliente),
        duracao: '300 seconds',
      });
      const lote = await criarLote(cliente, {
        leiloeiro,
        snapshot: await criarSnapshot(cliente),
        duracao: '7 days',
      });

      // Anti-sniping (specs/007): só fim_em cresce; fim_original_em continua o da criação.
      await cliente.query(`update lots set fim_em = fim_em + interval '2 minutes' where id = $1`, [
        lote,
      ]);
    });
  });

  it('lots: fim_original_em fora de 5 min a 7 dias é recusado mesmo com fim_em diferente', async () => {
    await emTransacao(async (cliente) => {
      const leiloeiro = await criarLeiloeiro(cliente);
      const inserir = `insert into lots
        (leiloeiro_id, snapshot_id, carta_nome, raridade, titulo, lance_inicial_centavos,
         incremento_minimo_centavos, inicio_em, fim_em, fim_original_em, status)
        values ($1, $2, 'Black Lotus', 'rare', 'Lotus', 100, 100, now(), now() + $3::interval,
                now() + $4::interval, 'agendado')`;
      const tentar = async (fim: string, fimOriginal: string): Promise<string | undefined> =>
        codigoDaFalha(cliente, inserir, [
          leiloeiro,
          await criarSnapshot(cliente),
          fim,
          fimOriginal,
        ]);

      expect(await tentar('1 hour', '299 seconds')).toBe(SQLSTATE.check);
      expect(await tentar('8 days', '7 days 1 second')).toBe(SQLSTATE.check);
      await cliente.query(inserir, [leiloeiro, await criarSnapshot(cliente), '8 days', '7 days']);
    });
  });

  it('lots: lance atual ≥ inicial, arremate > 0, total ≥ 0, fim_em ≥ fim_original_em', async () => {
    await emTransacao(async (cliente) => {
      const leiloeiro = await criarLeiloeiro(cliente);
      const lote = await criarLote(cliente, {
        leiloeiro,
        snapshot: await criarSnapshot(cliente),
        lanceInicial: 500,
      });
      const atualizar = (atribuicao: string): string =>
        `update lots set ${atribuicao} where id = $1`;

      for (const invalida of [
        'lance_atual_centavos = 499',
        'valor_arremate_centavos = 0',
        'total_lances = -1',
        `fim_em = fim_original_em - interval '1 millisecond'`,
      ]) {
        expect(await codigoDaFalha(cliente, atualizar(invalida), [lote])).toBe(SQLSTATE.check);
      }
      await cliente.query(
        atualizar(
          `lance_atual_centavos = 500, valor_arremate_centavos = 1, total_lances = 0,
           fim_em = fim_original_em`,
        ),
        [lote],
      );
    });
  });

  it('lots: DELETE do usuário ligado a um lote dá 23503', async () => {
    await emTransacao(async (cliente) => {
      const leiloeiro = await criarLeiloeiro(cliente);
      await criarLote(cliente, { leiloeiro, snapshot: await criarSnapshot(cliente) });

      expect(await codigoDaFalha(cliente, 'delete from users where id = $1', [leiloeiro])).toBe(
        SQLSTATE.fk,
      );
    });
  });

  it('lots: um snapshot por lote; FKs para users e card_snapshots', async () => {
    await emTransacao(async (cliente) => {
      const leiloeiro = await criarLeiloeiro(cliente);
      const snapshot = await criarSnapshot(cliente);
      const lote = await criarLote(cliente, { leiloeiro, snapshot });

      expect(
        await codigoDaFalha(cliente, INSERIR_LOTE, parametrosDoLote({ leiloeiro, snapshot })),
      ).toBe(SQLSTATE.unicidade);
      expect(
        await codigoDaFalha(
          cliente,
          INSERIR_LOTE,
          parametrosDoLote({ leiloeiro: randomUUID(), snapshot: await criarSnapshot(cliente) }),
        ),
      ).toBe(SQLSTATE.fk);
      expect(
        await codigoDaFalha(
          cliente,
          INSERIR_LOTE,
          parametrosDoLote({ leiloeiro, snapshot: randomUUID() }),
        ),
      ).toBe(SQLSTATE.fk);
      for (const coluna of ['lider_id', 'vencedor_id']) {
        expect(
          await codigoDaFalha(cliente, `update lots set ${coluna} = $2 where id = $1`, [
            lote,
            randomUUID(),
          ]),
        ).toBe(SQLSTATE.fk);
      }
      await cliente.query('update lots set lider_id = $2, vencedor_id = $2 where id = $1', [
        lote,
        leiloeiro,
      ]);
    });
  });
});
