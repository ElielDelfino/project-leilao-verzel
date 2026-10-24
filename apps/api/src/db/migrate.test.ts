// Integração (Postgres real): runner de migrations e migration 0000 (tarefa 003).
// Conecta com POSTGRES_* + DB_PASSWORD (conexao.ts), cria um banco descartável, aplica as
// migrations do zero nele e o apaga no fim.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DrizzleQueryError } from 'drizzle-orm/errors';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type ConexaoDoBanco, lerConexaoDoBanco } from './conexao.js';
import { aplicarMigrations, descreverFalha, PASTA_DAS_MIGRATIONS } from './migrate.js';

const CONEXAO_ADMIN = lerConexaoDoBanco(process.env);
const NOME_DO_BANCO = `leilao_t003_${randomBytes(6).toString('hex')}`;
const CONEXAO_DO_BANCO: ConexaoDoBanco = { ...CONEXAO_ADMIN, database: NOME_DO_BANCO };

/** SQLSTATE restrict_violation, usado por impedir_alteracao(). */
const SQLSTATE_APPEND_ONLY = '23001';

interface Diario {
  readonly entries: readonly unknown[];
}

function quantidadeDeMigrations(): number {
  const diario = JSON.parse(
    readFileSync(join(PASTA_DAS_MIGRATIONS, 'meta', '_journal.json'), 'utf8'),
  ) as Diario;
  return diario.entries.length;
}

async function comCliente<T>(
  conexao: ConexaoDoBanco,
  fn: (cliente: pg.Client) => Promise<T>,
): Promise<T> {
  const cliente = new pg.Client(conexao);
  await cliente.connect();
  try {
    return await fn(cliente);
  } finally {
    await cliente.end();
  }
}

async function rotulosDoEnum(cliente: pg.Client, tipo: string): Promise<string[]> {
  const { rows } = await cliente.query<{ rotulo: string }>(
    `select e.enumlabel as rotulo
       from pg_enum e join pg_type t on t.oid = e.enumtypid
       join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public' and t.typname = $1
      order by e.enumsortorder`,
    [tipo],
  );
  return rows.map((linha) => linha.rotulo);
}

/** Executa o comando e devolve o erro do Postgres (ou falha o teste se ele passar). */
async function erroDe(cliente: pg.Client, comando: string): Promise<pg.DatabaseError> {
  try {
    await cliente.query(comando);
  } catch (erro: unknown) {
    if (erro instanceof pg.DatabaseError) {
      return erro;
    }
    throw erro;
  }
  throw new Error(`o comando deveria ter falhado: ${comando}`);
}

beforeAll(async () => {
  await comCliente(CONEXAO_ADMIN, (cliente) => cliente.query(`create database ${NOME_DO_BANCO}`));
});

afterAll(async () => {
  await comCliente(CONEXAO_ADMIN, (cliente) =>
    cliente.query(`drop database if exists ${NOME_DO_BANCO} with (force)`),
  );
});

describe('descreverFalha', () => {
  it('mostra o SQLSTATE e a mensagem do Postgres, não o SQL do Drizzle', () => {
    const causa = new pg.DatabaseError('type "papel_usuario" already exists', 0, 'error');
    causa.code = '42710';
    const erro = new DrizzleQueryError('CREATE TYPE ...', [], causa);

    expect(descreverFalha(erro)).toBe('SQLSTATE 42710: type "papel_usuario" already exists');
  });

  it('mostra nome e código de uma falha de conexão', () => {
    const erro = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:15432'), {
      code: 'ECONNREFUSED',
    });

    expect(descreverFalha(erro)).toBe('Error (ECONNREFUSED): connect ECONNREFUSED 127.0.0.1:15432');
    expect(descreverFalha('x')).toBe('falha desconhecida');
  });
});

describe('pnpm db:migrate (aplicarMigrations)', () => {
  it('aplica do zero, mesmo com duas execuções simultâneas', async () => {
    await Promise.all([aplicarMigrations(CONEXAO_DO_BANCO), aplicarMigrations(CONEXAO_DO_BANCO)]);

    const aplicadas = await comCliente(CONEXAO_DO_BANCO, async (cliente) => {
      const { rows } = await cliente.query<{ total: string }>(
        'select count(*) as total from drizzle.__drizzle_migrations',
      );
      return Number(rows[0]?.total);
    });
    expect(aplicadas).toBe(quantidadeDeMigrations());
  });

  it('é idempotente: rodar de novo não reaplica nem falha', async () => {
    await aplicarMigrations(CONEXAO_DO_BANCO);
    await aplicarMigrations(CONEXAO_DO_BANCO);

    const aplicadas = await comCliente(CONEXAO_DO_BANCO, async (cliente) => {
      const { rows } = await cliente.query<{ total: string }>(
        'select count(*) as total from drizzle.__drizzle_migrations',
      );
      return Number(rows[0]?.total);
    });
    expect(aplicadas).toBe(quantidadeDeMigrations());
  });
});

describe('migration 0000 (base)', () => {
  it('cria as extensões citext e pg_trgm', async () => {
    const extensoes = await comCliente(CONEXAO_DO_BANCO, async (cliente) => {
      const { rows } = await cliente.query<{ extname: string }>(
        `select extname from pg_extension where extname in ('citext', 'pg_trgm') order by extname`,
      );
      return rows.map((linha) => linha.extname);
    });
    expect(extensoes).toEqual(['citext', 'pg_trgm']);
  });

  it('cria os enums com os valores das specs, na ordem', async () => {
    await comCliente(CONEXAO_DO_BANCO, async (cliente) => {
      // specs/003 RF-01
      expect(await rotulosDoEnum(cliente, 'papel_usuario')).toEqual(['leiloeiro', 'licitante']);
      // specs/006 §Comportamento (estados)
      expect(await rotulosDoEnum(cliente, 'status_lote')).toEqual([
        'agendado',
        'ao_vivo',
        'encerrado',
        'cancelado',
      ]);
      // specs/004 §Comportamento (tipos de lançamento)
      expect(await rotulosDoEnum(cliente, 'tipo_lancamento')).toEqual([
        'deposito',
        'compromisso',
        'liberacao',
        'estorno',
        'debito_arremate',
        'credito_arremate',
      ]);
    });
  });
});

describe('impedir_alteracao()', () => {
  // Tabela temporária (some com a sessão) com os triggers que as tabelas append-only usarão.
  async function prepararTabela(cliente: pg.Client): Promise<void> {
    await cliente.query('create temp table historico (id int primary key, valor bigint not null)');
    await cliente.query(
      `create trigger historico_append_only before update or delete on historico
         for each row execute function impedir_alteracao()`,
    );
    await cliente.query(
      `create trigger historico_sem_truncate before truncate on historico
         for each statement execute function impedir_alteracao()`,
    );
    await cliente.query('insert into historico (id, valor) values (1, 100), (2, 200)');
  }

  async function linhas(cliente: pg.Client): Promise<{ id: number; valor: string }[]> {
    const { rows } = await cliente.query<{ id: number; valor: string }>(
      'select id, valor from historico order by id',
    );
    return rows;
  }

  it('permite INSERT', async () => {
    await comCliente(CONEXAO_DO_BANCO, async (cliente) => {
      await prepararTabela(cliente);
      await cliente.query('insert into historico (id, valor) values (3, 300)');

      expect(await linhas(cliente)).toHaveLength(3);
    });
  });

  it('recusa UPDATE com restrict_violation, sem alterar a linha', async () => {
    await comCliente(CONEXAO_DO_BANCO, async (cliente) => {
      await prepararTabela(cliente);

      const erro = await erroDe(cliente, 'update historico set valor = 999 where id = 1');

      expect(erro.code).toBe(SQLSTATE_APPEND_ONLY);
      expect(erro.table).toBe('historico');
      expect(erro.message).toContain('UPDATE');
      expect(erro.message).not.toContain('999');
      expect(await linhas(cliente)).toEqual([
        { id: 1, valor: '100' },
        { id: 2, valor: '200' },
      ]);
    });
  });

  it('recusa DELETE com restrict_violation, sem remover a linha', async () => {
    await comCliente(CONEXAO_DO_BANCO, async (cliente) => {
      await prepararTabela(cliente);

      const erro = await erroDe(cliente, 'delete from historico where id = 2');

      expect(erro.code).toBe(SQLSTATE_APPEND_ONLY);
      expect(erro.message).toContain('DELETE');
      expect(await linhas(cliente)).toHaveLength(2);
    });
  });

  it('recusa TRUNCATE quando ligada a um trigger de instrução', async () => {
    await comCliente(CONEXAO_DO_BANCO, async (cliente) => {
      await prepararTabela(cliente);

      const erro = await erroDe(cliente, 'truncate historico');

      expect(erro.code).toBe(SQLSTATE_APPEND_ONLY);
      expect(erro.message).toContain('TRUNCATE');
      expect(await linhas(cliente)).toHaveLength(2);
    });
  });
});
