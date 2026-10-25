// Runner de `pnpm db:migrate` (tarefa 003): aplica as migrations SQL de
// database/postgres/migrations (forward-only, ADR 0001) no banco de POSTGRES_* + DB_PASSWORD
// (conexao.ts). Idempotente: o migrator do Drizzle registra cada migration em
// drizzle.__drizzle_migrations e só aplica as novas, todas numa transação; um advisory lock
// serializa execuções simultâneas (deploy e verify, por exemplo).
//
// Roda direto no Node >= 24.2 (type stripping e import.meta.main) com o hook resolver-ts.mjs
// (script na raiz).
import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

import { causaParaExibir, comClienteAvulso, criarClientePg, SEM_CAUSA } from './cliente-avulso.js';
import { type ConexaoDoBanco, ErroDeConfiguracaoDoBanco, lerConexaoDoBanco } from './conexao.js';

/** Pasta das migrations; de src/db/ ou dist/db/, a raiz do repositório fica 4 níveis acima. */
export const PASTA_DAS_MIGRATIONS = fileURLToPath(
  new URL('../../../../database/postgres/migrations', import.meta.url),
);

/** Chave do advisory lock das migrations (constante arbitrária, só precisa ser única no banco). */
const CHAVE_DO_LOCK = 3_003_000_001;

/** Quanto uma execução espera a outra liberar o lock antes de desistir (lock_timeout). */
export const ESPERA_PADRAO_DO_LOCK_MS = 60_000;

export interface OpcoesDasMigrations {
  readonly pasta?: string;
  readonly esperaDoLockMs?: number;
}

/**
 * Aplica as migrations pendentes numa única conexão (o advisory lock vale por sessão). Se a
 * migração falhar, o unlock nem é tentado: fechar a sessão libera o lock, e assim nenhuma falha
 * secundária esconde a original.
 */
export async function aplicarMigrations(
  conexao: ConexaoDoBanco,
  opcoes: OpcoesDasMigrations = {},
): Promise<void> {
  const pasta = opcoes.pasta ?? PASTA_DAS_MIGRATIONS;
  const espera = opcoes.esperaDoLockMs ?? ESPERA_PADRAO_DO_LOCK_MS;
  await comClienteAvulso(
    conexao,
    async (cliente) => {
      // Sem limite, uma segunda execução esperaria para sempre por uma primeira travada.
      await cliente.query("select set_config('lock_timeout', $1, false)", [
        String(Math.trunc(espera)),
      ]);
      await cliente.query('select pg_advisory_lock($1)', [CHAVE_DO_LOCK]);
      await cliente.query('reset lock_timeout');
      await migrate(drizzle({ client: cliente }), { migrationsFolder: pasta });
      await cliente.query('select pg_advisory_unlock($1)', [CHAVE_DO_LOCK]);
    },
    criarClientePg,
  );
}

/**
 * Descrição da falha para o terminal. Migrations não levam dados de usuário, então a mensagem
 * do Postgres (ex.: "type ... already exists") é mostrada; a do DrizzleQueryError (SQL e
 * parâmetros) nunca é, e a senha nunca entra em mensagem.
 */
export function descreverFalha(erro: unknown): string {
  const causa = causaParaExibir(erro);
  if (causa === SEM_CAUSA) {
    return 'consulta do Drizzle falhou sem causa do driver';
  }
  if (causa instanceof pg.DatabaseError) {
    return `SQLSTATE ${causa.code ?? '?'}: ${causa.message}`;
  }
  if (causa instanceof ErroDeConfiguracaoDoBanco) {
    return causa.message;
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
