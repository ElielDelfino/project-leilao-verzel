// Integração (Postgres real): migration 0001 (tarefa 037). Papel da API (D2 e D3 da tarefa 036),
// triggers append-only (specs/008, specs/004 §Dados) e restrições de users, refresh_tokens,
// ledger_entries e wallet_balances (specs/003 e 004 §Dados). Roda no banco de teste do worktree
// (clonado do modelo com as migrations); cada teste trabalha numa transação desfeita no fim.
import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { describe, expect, it } from 'vitest';

import { ambienteDeTeste } from './ambiente-de-teste.js';

const AMBIENTE = ambienteDeTeste(process.env);

/** Papel da API criado pela migration 0001. */
const PAPEL_DA_API = 'leilao_api';

/**
 * Tabelas append-only (specs/008). A F3 acrescenta 'bids' e 'lot_seals'; cada uma precisa ligar
 * os dois triggers com public.impedir_alteracao().
 */
const TABELAS_APPEND_ONLY = ['ledger_entries'] as const;

/**
 * Matriz D3 da tarefa 036: privilégios efetivos de leilao_api em cada tabela de public. Toda
 * tabela nova de public precisa entrar aqui (com [] se a API não a acessa), senão o teste falha.
 */
const MATRIZ: Readonly<Record<string, readonly string[]>> = {
  users: ['INSERT', 'SELECT'],
  refresh_tokens: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'],
  wallet_balances: ['INSERT', 'SELECT', 'UPDATE'],
  ledger_entries: ['INSERT', 'SELECT'],
};

/** Todos os privilégios de tabela do Postgres 18. */
const PRIVILEGIOS = [
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'TRUNCATE',
  'REFERENCES',
  'TRIGGER',
  'MAINTAIN',
] as const;

/** pg_trigger.tgtype: ROW = 1, BEFORE = 2, DELETE = 8, UPDATE = 16, TRUNCATE = 32. */
const TIPO_LINHA_ANTES_DE_UPDATE_OU_DELETE = 1 | 2 | 8 | 16;
const TIPO_INSTRUCAO_ANTES_DE_TRUNCATE = 2 | 32;

const SQLSTATE = {
  semPrivilegio: '42501',
  appendOnly: '23001',
  check: '23514',
  unicidade: '23505',
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

async function criarUsuario(
  cliente: pg.Client,
  email = `${randomUUID()}@teste.local`,
): Promise<string> {
  const { rows } = await cliente.query<{ id: string }>(
    `insert into users (nome, email, senha_hash, papel)
     values ('Ana', $1, 'hash', 'licitante') returning id`,
    [email],
  );
  return String(rows[0]?.id);
}

async function deposito(
  cliente: pg.Client,
  usuario: string,
  chave: string | null = null,
): Promise<void> {
  await cliente.query(
    `insert into ledger_entries (user_id, tipo, valor_centavos, idempotency_key)
     values ($1, 'deposito', 1000, $2)`,
    [usuario, chave],
  );
}

describe.skipIf(!AMBIENTE.disponivel)('migration 0001: papel da API', () => {
  it('leilao_api existe sem nenhum atributo de administração e sem herança', async () => {
    await emTransacao(async (cliente) => {
      const { rows } = await cliente.query(
        `select rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls, rolinherit
           from pg_roles where rolname = $1`,
        [PAPEL_DA_API],
      );

      expect(rows).toEqual([
        {
          rolsuper: false,
          rolcreatedb: false,
          rolcreaterole: false,
          rolreplication: false,
          rolbypassrls: false,
          rolinherit: false,
        },
      ]);
    });
  });

  it('os privilégios em cada tabela de public são exatamente os da matriz D3', async () => {
    await emTransacao(async (cliente) => {
      const { rows } = await cliente.query<{ tabela: string; privilegios: string[] }>(
        `select c.relname as tabela,
                array(select p from unnest($2::text[]) p
                       where has_table_privilege($1, c.oid, p) order by p) as privilegios
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
          order by c.relname`,
        [PAPEL_DA_API, PRIVILEGIOS],
      );
      const efetivos = Object.fromEntries(rows.map((linha) => [linha.tabela, linha.privilegios]));
      const esperados = Object.fromEntries(
        Object.entries(MATRIZ).map(([tabela, privilegios]) => [tabela, [...privilegios].sort()]),
      );

      expect(efetivos).toEqual(esperados);
    });
  });

  it('sem privilégio de coluna, sem default privileges e sem acesso ao schema drizzle', async () => {
    await emTransacao(async (cliente) => {
      const { rows } = await cliente.query(
        `select
           (select count(*)::int from pg_attribute a
              join pg_class c on c.oid = a.attrelid
              join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and a.attacl is not null) as colunas,
           (select count(*)::int from pg_default_acl) as padroes,
           has_schema_privilege($1, 'public', 'USAGE') as usa_public,
           has_schema_privilege($1, 'public', 'CREATE') as cria_em_public,
           has_schema_privilege($1, 'drizzle', 'USAGE') as usa_drizzle`,
        [PAPEL_DA_API],
      );

      expect(rows).toEqual([
        { colunas: 0, padroes: 0, usa_public: true, cria_em_public: false, usa_drizzle: false },
      ]);
    });
  });
});

describe.skipIf(!AMBIENTE.disponivel)('migration 0001: tabelas append-only', () => {
  it.each(TABELAS_APPEND_ONLY)(
    '%s liga os dois triggers, habilitados, com impedir_alteracao()',
    async (tabela) => {
      await emTransacao(async (cliente) => {
        const { rows } = await cliente.query<{
          tipo: number;
          habilitado: boolean;
          funcao: boolean;
        }>(
          `select t.tgtype::int as tipo, t.tgenabled <> 'D' as habilitado,
                  t.tgfoid = 'public.impedir_alteracao()'::regprocedure as funcao
             from pg_trigger t
            where t.tgrelid = to_regclass('public.' || $1) and not t.tgisinternal
            order by t.tgtype`,
          [tabela],
        );

        expect(rows).toEqual([
          { tipo: TIPO_LINHA_ANTES_DE_UPDATE_OU_DELETE, habilitado: true, funcao: true },
          { tipo: TIPO_INSTRUCAO_ANTES_DE_TRUNCATE, habilitado: true, funcao: true },
        ]);
      });
    },
  );

  it('impedir_alteracao() tem search_path vazio e leilao_api não tem EXECUTE nela', async () => {
    await emTransacao(async (cliente) => {
      const { rows } = await cliente.query(
        `select p.proconfig as config,
                has_function_privilege($1, p.oid, 'EXECUTE') as executa
           from pg_proc p where p.oid = 'public.impedir_alteracao()'::regprocedure`,
        [PAPEL_DA_API],
      );

      expect(rows).toEqual([{ config: ['search_path=""'], executa: false }]);
    });
  });

  it('como leilao_api: INSERT e SELECT funcionam; UPDATE, DELETE e TRUNCATE dão 42501', async () => {
    await emTransacao(async (cliente) => {
      await cliente.query(`set local role ${PAPEL_DA_API}`);
      const usuario = await criarUsuario(cliente);
      await deposito(cliente, usuario);

      const { rows } = await cliente.query(
        'select count(*)::int as total from ledger_entries where user_id = $1',
        [usuario],
      );
      expect(rows).toEqual([{ total: 1 }]);
      expect(await codigoDaFalha(cliente, 'update ledger_entries set valor_centavos = 1')).toBe(
        SQLSTATE.semPrivilegio,
      );
      expect(await codigoDaFalha(cliente, 'delete from ledger_entries')).toBe(
        SQLSTATE.semPrivilegio,
      );
      expect(await codigoDaFalha(cliente, 'truncate ledger_entries')).toBe(SQLSTATE.semPrivilegio);
    });
  });

  it('como leilao_api: não desliga triggers, não muda session_replication_role, não cria tabela', async () => {
    await emTransacao(async (cliente) => {
      await cliente.query(`set local role ${PAPEL_DA_API}`);

      expect(await codigoDaFalha(cliente, 'alter table ledger_entries disable trigger all')).toBe(
        SQLSTATE.semPrivilegio,
      );
      expect(await codigoDaFalha(cliente, 'set session_replication_role = replica')).toBe(
        SQLSTATE.semPrivilegio,
      );
      expect(await codigoDaFalha(cliente, 'create table public.intrusa (id int)')).toBe(
        SQLSTATE.semPrivilegio,
      );
    });
  });

  it('como dono: UPDATE, DELETE e TRUNCATE em ledger_entries dão 23001', async () => {
    await emTransacao(async (cliente) => {
      const usuario = await criarUsuario(cliente);
      await deposito(cliente, usuario);

      expect(await codigoDaFalha(cliente, 'update ledger_entries set valor_centavos = 1')).toBe(
        SQLSTATE.appendOnly,
      );
      expect(await codigoDaFalha(cliente, 'delete from ledger_entries')).toBe(SQLSTATE.appendOnly);
      expect(await codigoDaFalha(cliente, 'truncate ledger_entries')).toBe(SQLSTATE.appendOnly);
    });
  });
});

describe.skipIf(!AMBIENTE.disponivel)('migration 0001: restrições', () => {
  it('ledger_entries: valor ≤ 0 dá 23514', async () => {
    await emTransacao(async (cliente) => {
      const usuario = await criarUsuario(cliente);
      const inserir = `insert into ledger_entries (user_id, tipo, valor_centavos) values ($1, 'deposito', $2)`;

      expect(await codigoDaFalha(cliente, inserir, [usuario, 0])).toBe(SQLSTATE.check);
      expect(await codigoDaFalha(cliente, inserir, [usuario, -100])).toBe(SQLSTATE.check);
    });
  });

  it('ledger_entries: chave de idempotência repetida no mesmo usuário dá 23505; em outro, entra', async () => {
    await emTransacao(async (cliente) => {
      const ana = await criarUsuario(cliente);
      const bia = await criarUsuario(cliente);
      const chave = randomUUID();
      await deposito(cliente, ana, chave);
      await deposito(cliente, ana);
      await deposito(cliente, ana);

      const repetida = `insert into ledger_entries (user_id, tipo, valor_centavos, idempotency_key)
                        values ($1, 'deposito', 1000, $2)`;
      expect(await codigoDaFalha(cliente, repetida, [ana, chave])).toBe(SQLSTATE.unicidade);
      await deposito(cliente, bia, chave);
    });
  });

  it('ledger_entries e wallet_balances: user_id precisa existir em users', async () => {
    await emTransacao(async (cliente) => {
      const fantasma = randomUUID();

      expect(
        await codigoDaFalha(
          cliente,
          `insert into ledger_entries (user_id, tipo, valor_centavos) values ($1, 'deposito', 1)`,
          [fantasma],
        ),
      ).toBe('23503');
      expect(
        await codigoDaFalha(cliente, 'insert into wallet_balances (user_id) values ($1)', [
          fantasma,
        ]),
      ).toBe('23503');
    });
  });

  it('wallet_balances: nasce com zeros; comprometido > total ou negativo dá 23514', async () => {
    await emTransacao(async (cliente) => {
      const usuario = await criarUsuario(cliente);
      const { rows } = await cliente.query(
        `insert into wallet_balances (user_id) values ($1)
         returning total_centavos::int as total, comprometido_centavos::int as comprometido`,
        [usuario],
      );
      expect(rows).toEqual([{ total: 0, comprometido: 0 }]);

      const mudar =
        'update wallet_balances set total_centavos = $2, comprometido_centavos = $3 where user_id = $1';
      expect(await codigoDaFalha(cliente, mudar, [usuario, 100, 101])).toBe(SQLSTATE.check);
      expect(await codigoDaFalha(cliente, mudar, [usuario, 100, -1])).toBe(SQLSTATE.check);
      await cliente.query(mudar, [usuario, 100, 100]);
    });
  });

  it('users: nome de 2 a 80 caracteres, e-mail até 254 e único sem diferenciar maiúsculas', async () => {
    await emTransacao(async (cliente) => {
      const inserir = `insert into users (nome, email, senha_hash, papel) values ($1, $2, 'h', 'leiloeiro')`;
      const email = (): string => `${randomUUID()}@teste.local`;

      expect(await codigoDaFalha(cliente, inserir, ['A', email()])).toBe(SQLSTATE.check);
      expect(await codigoDaFalha(cliente, inserir, ['A'.repeat(81), email()])).toBe(SQLSTATE.check);
      await cliente.query(inserir, ['Ab', email()]);
      await cliente.query(inserir, ['A'.repeat(80), email()]);
      const longo = `${'a'.repeat(243)}@teste.local`;
      expect(longo).toHaveLength(255);
      expect(await codigoDaFalha(cliente, inserir, ['Ana', longo])).toBe(SQLSTATE.check);
      await cliente.query(inserir, ['Ana', longo.slice(1)]);
      await cliente.query(inserir, ['Ana', 'Caixa@Teste.Local']);
      expect(await codigoDaFalha(cliente, inserir, ['Ana', 'caixa@teste.local'])).toBe(
        SQLSTATE.unicidade,
      );
    });
  });

  it('refresh_tokens: token_hash de 32 bytes e único; substituido_por aponta para outro token', async () => {
    await emTransacao(async (cliente) => {
      const usuario = await criarUsuario(cliente);
      const inserir = `insert into refresh_tokens (user_id, familia_id, token_hash, expira_em, substituido_por)
                       values ($1, $2, $3, now() + interval '7 days', $4) returning id`;
      const familia = randomUUID();
      const hash = Buffer.alloc(32, 1);

      expect(
        await codigoDaFalha(cliente, inserir, [usuario, familia, Buffer.alloc(31), null]),
      ).toBe(SQLSTATE.check);
      const { rows } = await cliente.query<{ id: string }>(inserir, [usuario, familia, hash, null]);
      expect(await codigoDaFalha(cliente, inserir, [usuario, familia, hash, null])).toBe(
        SQLSTATE.unicidade,
      );
      expect(
        await codigoDaFalha(cliente, inserir, [
          usuario,
          familia,
          Buffer.alloc(32, 2),
          randomUUID(),
        ]),
      ).toBe('23503');
      await cliente.query(inserir, [usuario, familia, Buffer.alloc(32, 3), rows[0]?.id]);
    });
  });

  it('refresh_tokens: apagar o token apontado zera substituido_por (ON DELETE SET NULL)', async () => {
    await emTransacao(async (cliente) => {
      const usuario = await criarUsuario(cliente);
      const inserir = `insert into refresh_tokens (user_id, familia_id, token_hash, expira_em, substituido_por)
                       values ($1, $2, $3, now(), $4) returning id`;
      const familia = randomUUID();
      const novo = await cliente.query<{ id: string }>(inserir, [
        usuario,
        familia,
        Buffer.alloc(32, 4),
        null,
      ]);
      const antigo = await cliente.query<{ id: string }>(inserir, [
        usuario,
        familia,
        Buffer.alloc(32, 5),
        novo.rows[0]?.id,
      ]);

      await cliente.query('delete from refresh_tokens where id = $1', [novo.rows[0]?.id]);

      const { rows } = await cliente.query(
        'select substituido_por from refresh_tokens where id = $1',
        [antigo.rows[0]?.id],
      );
      expect(rows).toEqual([{ substituido_por: null }]);
    });
  });

  it('centavos acima de 2^53 − 1 dão 23514 (lidos em modo number pela API)', async () => {
    await emTransacao(async (cliente) => {
      const usuario = await criarUsuario(cliente);
      const MAXIMO = String(Number.MAX_SAFE_INTEGER);
      const ACIMA = (BigInt(Number.MAX_SAFE_INTEGER) + 1n).toString();
      const lancar = `insert into ledger_entries (user_id, tipo, valor_centavos) values ($1, 'deposito', $2::bigint)`;
      await cliente.query('insert into wallet_balances (user_id) values ($1)', [usuario]);
      const saldo =
        'update wallet_balances set total_centavos = $2::bigint, comprometido_centavos = $3::bigint where user_id = $1';

      expect(await codigoDaFalha(cliente, lancar, [usuario, ACIMA])).toBe(SQLSTATE.check);
      await cliente.query(lancar, [usuario, MAXIMO]);
      expect(await codigoDaFalha(cliente, saldo, [usuario, ACIMA, 0])).toBe(SQLSTATE.check);
      expect(await codigoDaFalha(cliente, saldo, [usuario, ACIMA, ACIMA])).toBe(SQLSTATE.check);
      await cliente.query(saldo, [usuario, MAXIMO, MAXIMO]);
    });
  });

  it('os três CHECKs de valor seguro existem com o limite 2^53 − 1', async () => {
    await emTransacao(async (cliente) => {
      const { rows } = await cliente.query<{ nome: string; definicao: string }>(
        `select conname as nome, pg_get_constraintdef(oid) as definicao from pg_constraint
          where conname like '%\\_seguro' and connamespace = 'public'::regnamespace
          order by conname`,
      );

      expect(rows.map((linha) => linha.nome)).toEqual([
        'ledger_entries_valor_seguro',
        'wallet_balances_comprometido_seguro',
        'wallet_balances_total_seguro',
      ]);
      for (const linha of rows) {
        expect(linha.definicao).toContain(String(Number.MAX_SAFE_INTEGER));
      }
    });
  });
});
