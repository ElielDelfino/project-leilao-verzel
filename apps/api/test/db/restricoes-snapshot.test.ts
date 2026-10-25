// Integração (Postgres real): o banco migrado bate com o snapshot do drizzle-kit (pendência da
// tarefa 037, feita na 051). Se alguém editar o SQL de uma migration sem passar pelo schema.ts
// (ou o contrário), as restrições e os índices divergem do snapshot e o `db:generate` seguinte
// geraria um diff inesperado. A exceção são as FKs entre módulos, escritas à mão no SQL porque a
// fronteira de specs/001 §Módulos impede declará-las nos schema.ts: elas ficam listadas aqui.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import pg from 'pg';
import { describe, expect, it } from 'vitest';

import { PASTA_DAS_MIGRATIONS } from '../../src/db/migrate.js';
import { ambienteDeTeste } from './ambiente-de-teste.js';

const AMBIENTE = ambienteDeTeste(process.env);

interface FkManual {
  readonly tabela: string;
  readonly coluna: string;
  readonly alvo: string;
}

/** FKs só no SQL (fora dos schema.ts); todas apontam para `<alvo>(id)`. */
const FKS_SO_NO_SQL: Readonly<Record<string, FkManual>> = {
  ledger_entries_user_id_users_id_fk: {
    tabela: 'ledger_entries',
    coluna: 'user_id',
    alvo: 'users',
  },
  wallet_balances_user_id_users_id_fk: {
    tabela: 'wallet_balances',
    coluna: 'user_id',
    alvo: 'users',
  },
  lots_leiloeiro_id_users_id_fk: { tabela: 'lots', coluna: 'leiloeiro_id', alvo: 'users' },
  lots_snapshot_id_card_snapshots_id_fk: {
    tabela: 'lots',
    coluna: 'snapshot_id',
    alvo: 'card_snapshots',
  },
  lots_lider_id_users_id_fk: { tabela: 'lots', coluna: 'lider_id', alvo: 'users' },
  lots_vencedor_id_users_id_fk: { tabela: 'lots', coluna: 'vencedor_id', alvo: 'users' },
};

interface TabelaDoSnapshot {
  readonly name: string;
  readonly columns: Readonly<Record<string, { readonly primaryKey: boolean }>>;
  readonly indexes: Readonly<Record<string, unknown>>;
  readonly foreignKeys: Readonly<Record<string, unknown>>;
  readonly compositePrimaryKeys: Readonly<Record<string, unknown>>;
  readonly uniqueConstraints: Readonly<Record<string, unknown>>;
  readonly checkConstraints: Readonly<Record<string, unknown>>;
}

interface Snapshot {
  readonly tables: Readonly<Record<string, TabelaDoSnapshot>>;
}

/** O snapshot da última migration do _journal.json. */
function ultimoSnapshot(): Snapshot {
  const diario = JSON.parse(
    readFileSync(join(PASTA_DAS_MIGRATIONS, 'meta', '_journal.json'), 'utf8'),
  ) as { readonly entries: readonly { readonly idx: number }[] };
  const ultimo = Math.max(...diario.entries.map((entrada) => entrada.idx));
  const arquivo = `${String(ultimo).padStart(4, '0')}_snapshot.json`;
  return JSON.parse(readFileSync(join(PASTA_DAS_MIGRATIONS, 'meta', arquivo), 'utf8')) as Snapshot;
}

/** `tabela.restricao:tipo` (p, u, c, f), como o pg_constraint os nomeia. */
function restricoesDoSnapshot(snapshot: Snapshot): string[] {
  return Object.values(snapshot.tables).flatMap((tabela) => {
    const temPkDeColuna = Object.values(tabela.columns).some((coluna) => coluna.primaryKey);
    const nomes = [
      ...(temPkDeColuna ? [`${tabela.name}_pkey:p`] : []),
      ...Object.keys(tabela.compositePrimaryKeys).map((nome) => `${nome}:p`),
      ...Object.keys(tabela.uniqueConstraints).map((nome) => `${nome}:u`),
      ...Object.keys(tabela.checkConstraints).map((nome) => `${nome}:c`),
      ...Object.keys(tabela.foreignKeys).map((nome) => `${nome}:f`),
    ];
    return nomes.map((nome) => `${tabela.name}.${nome}`);
  });
}

async function consultar<T extends pg.QueryResultRow>(comando: string): Promise<T[]> {
  const cliente = new pg.Client(AMBIENTE.conexao());
  await cliente.connect();
  try {
    const { rows } = await cliente.query<T>(comando);
    return rows;
  } finally {
    await cliente.end();
  }
}

describe.skipIf(!AMBIENTE.disponivel)('banco migrado × snapshot do drizzle-kit', () => {
  it('as restrições de public são as do snapshot mais as FKs escritas à mão', async () => {
    const linhas = await consultar<{ chave: string }>(
      `select c.conrelid::regclass::text || '.' || c.conname || ':' || c.contype::text as chave
         from pg_constraint c
        where c.connamespace = 'public'::regnamespace and c.contype in ('p', 'u', 'c', 'f')`,
    );
    const manuais = Object.entries(FKS_SO_NO_SQL).map(([nome, fk]) => `${fk.tabela}.${nome}:f`);

    expect(linhas.map((linha) => linha.chave).sort()).toEqual(
      [...restricoesDoSnapshot(ultimoSnapshot()), ...manuais].sort(),
    );
  });

  it('cada FK escrita à mão liga as colunas certas, sem CASCADE', async () => {
    const linhas = await consultar<{ nome: string; tabela: string; definicao: string }>(
      `select conname as nome, conrelid::regclass::text as tabela,
              pg_get_constraintdef(oid) as definicao
         from pg_constraint
        where connamespace = 'public'::regnamespace and contype = 'f'`,
    );
    const porNome = new Map(linhas.map((linha) => [linha.nome, linha]));

    for (const [nome, fk] of Object.entries(FKS_SO_NO_SQL)) {
      expect(porNome.get(nome), nome).toEqual({
        nome,
        tabela: fk.tabela,
        definicao: `FOREIGN KEY (${fk.coluna}) REFERENCES ${fk.alvo}(id)`,
      });
    }
  });

  it('os índices que não sustentam restrição são os do snapshot', async () => {
    const linhas = await consultar<{ chave: string }>(
      `select i.indrelid::regclass::text || '.' || c.relname as chave
         from pg_index i join pg_class c on c.oid = i.indexrelid
        where c.relnamespace = 'public'::regnamespace
          and not exists (select 1 from pg_constraint k where k.conindid = i.indexrelid)`,
    );
    const esperados = Object.values(ultimoSnapshot().tables).flatMap((tabela) =>
      Object.keys(tabela.indexes).map((nome) => `${tabela.name}.${nome}`),
    );

    expect(linhas.map((linha) => linha.chave).sort()).toEqual(esperados.sort());
  });
});
