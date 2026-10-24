// Runner de `pnpm db:migrate` (tarefa 003): aplica as migrations SQL de
// database/postgres/migrations (forward-only, ADR 0001) no banco de POSTGRES_* + DB_PASSWORD
// (conexao.ts). Idempotente: o migrator do Drizzle registra cada migration em
// drizzle.__drizzle_migrations e só aplica as novas, todas numa transação; um advisory lock
// serializa execuções simultâneas (deploy e verify, por exemplo).
//
// Roda direto no Node 24 com type stripping e o hook resolver-ts.mjs (script na raiz).
import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

import { type ConexaoDoBanco, lerConexaoDoBanco } from './conexao.js';

/** Pasta das migrations; de src/db/ ou dist/db/, a raiz do repositório fica 4 níveis acima. */
export const PASTA_DAS_MIGRATIONS = fileURLToPath(
  new URL('../../../../database/postgres/migrations', import.meta.url),
);

/** Chave do advisory lock das migrations (constante arbitrária, só precisa ser única no banco). */
const CHAVE_DO_LOCK = 3_003_000_001;

/** Aplica as migrations pendentes. Uma única conexão: o advisory lock vale por sessão. */
export async function aplicarMigrations(
  conexao: ConexaoDoBanco,
  pasta: string = PASTA_DAS_MIGRATIONS,
): Promise<void> {
  const cliente = new pg.Client(conexao);
  await cliente.connect();
  try {
    await cliente.query('select pg_advisory_lock($1)', [CHAVE_DO_LOCK]);
    try {
      await migrate(drizzle({ client: cliente }), { migrationsFolder: pasta });
    } finally {
      await cliente.query('select pg_advisory_unlock($1)', [CHAVE_DO_LOCK]);
    }
  } finally {
    await cliente.end();
  }
}

/**
 * Descrição da falha para o terminal. Migrations não levam dados de usuário, então a mensagem
 * do Postgres (ex.: "type ... already exists") é mostrada; a senha nunca entra em mensagem.
 */
export function descreverFalha(erro: unknown): string {
  const causa = erro instanceof Error && erro.cause instanceof Error ? erro.cause : erro;
  if (causa instanceof pg.DatabaseError) {
    return `SQLSTATE ${causa.code ?? '?'}: ${causa.message}`;
  }
  if (causa instanceof Error) {
    const codigo = 'code' in causa && typeof causa.code === 'string' ? ` (${causa.code})` : '';
    return `${causa.name}${codigo}: ${causa.message}`;
  }
  return 'falha desconhecida';
}

async function principal(): Promise<void> {
  await aplicarMigrations(lerConexaoDoBanco(process.env));
  process.stdout.write('db:migrate: migrations aplicadas (ou já em dia).\n');
}

if (import.meta.main) {
  principal().catch((erro: unknown) => {
    process.stderr.write(`db:migrate falhou: ${descreverFalha(erro)}\n`);
    process.exitCode = 1;
  });
}
