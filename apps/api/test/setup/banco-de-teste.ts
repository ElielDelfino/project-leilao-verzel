// Banco de teste a partir de um modelo (tarefa 011, specs/013 §"pnpm verify:quick", ADR 0016).
// - O modelo (leilao_test_tpl) recebe as migrations de database/postgres/migrations e guarda o
//   hash da pasta no COMMENT ON DATABASE; só é refeito quando o hash muda (ou falta).
// - O banco de teste (leilao_test) é apagado e recriado a cada execução com
//   CREATE DATABASE leilao_test TEMPLATE leilao_test_tpl.
// A conexão "admin" é a de POSTGRES_* + DB_PASSWORD (conexao.ts), num banco que não seja nenhum
// dos dois. Um advisory lock serializa execuções simultâneas (worktrees no mesmo Postgres).
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import pg from 'pg';

import { type ConexaoDoBanco, trocarBanco } from '../../src/db/conexao.js';
import { aplicarMigrations, PASTA_DAS_MIGRATIONS } from '../../src/db/migrate.js';

export const BANCO_DE_TESTE = 'leilao_test';
export const BANCO_MODELO = 'leilao_test_tpl';

const PREFIXO_DO_HASH = 'migrations-sha256:';
/** Chave do advisory lock do preparo (diferente da das migrations, 3_003_000_001). */
const CHAVE_DO_LOCK = 3_011_000_001;
/** Nomes que dispensam aspas no Postgres (até 63 bytes). */
const NOME_DE_BANCO = /^[a-z_][a-z0-9_]{0,62}$/;

export interface OpcoesDoBancoDeTeste {
  readonly pasta?: string;
  readonly modelo?: string;
  readonly teste?: string;
}

export interface PreparoDoBancoDeTeste {
  /** O modelo foi (re)criado nesta execução: hash diferente, ausente ou modelo inexistente. */
  readonly modeloRefeito: boolean;
  readonly hash: string;
  /** Tempo do DROP + CREATE DATABASE ... TEMPLATE do banco de teste. */
  readonly msParaRecriar: number;
}

/** Arquivos da pasta (recursivo), em caminhos relativos com "/", em ordem estável. */
function arquivosDaPasta(pasta: string): string[] {
  return readdirSync(pasta, { recursive: true, withFileTypes: true })
    .filter((entrada) => entrada.isFile())
    .map((entrada) => relative(pasta, join(entrada.parentPath, entrada.name)).split(sep).join('/'))
    .sort();
}

/** SHA-256 (hex) dos nomes e conteúdos de todos os arquivos da pasta de migrations. */
export function hashDasMigrations(pasta: string = PASTA_DAS_MIGRATIONS): string {
  const hash = createHash('sha256');
  for (const arquivo of arquivosDaPasta(pasta)) {
    const conteudo = readFileSync(join(pasta, arquivo));
    // Nome e tamanho delimitam cada arquivo: mover bytes entre arquivos muda o hash.
    hash.update(`${arquivo}\0${conteudo.length}\0`);
    hash.update(conteudo);
  }
  return hash.digest('hex');
}

function validarNome(nome: string): string {
  if (!NOME_DE_BANCO.test(nome)) {
    throw new Error(`banco de teste: nome de banco inválido: ${JSON.stringify(nome)}`);
  }
  return nome;
}

async function comentarioDoBanco(cliente: pg.Client, nome: string): Promise<string | undefined> {
  const { rows } = await cliente.query<{ comentario: string | null }>(
    `select shobj_description(oid, 'pg_database') as comentario from pg_database where datname = $1`,
    [nome],
  );
  return rows[0]?.comentario ?? undefined;
}

async function refazerModelo(
  cliente: pg.Client,
  admin: ConexaoDoBanco,
  modelo: string,
  pasta: string,
  hash: string,
): Promise<void> {
  await cliente.query(`drop database if exists ${modelo} with (force)`);
  await cliente.query(`create database ${modelo}`);
  await aplicarMigrations(trocarBanco(admin, modelo), { pasta });
  // Sem conexões no modelo: uma conexão aberta faz o CREATE DATABASE ... TEMPLATE falhar.
  await cliente.query(`alter database ${modelo} with allow_connections false`);
  // Por último: um preparo interrompido deixa o modelo sem hash, e a próxima execução o refaz.
  await cliente.query(
    `comment on database ${modelo} is ${pg.escapeLiteral(`${PREFIXO_DO_HASH}${hash}`)}`,
  );
}

/**
 * Garante o modelo em dia com as migrations e recria o banco de teste a partir dele.
 * `admin` não pode apontar para o banco de teste nem para o modelo (eles são apagados).
 */
export async function prepararBancoDeTeste(
  admin: ConexaoDoBanco,
  opcoes: OpcoesDoBancoDeTeste = {},
): Promise<PreparoDoBancoDeTeste> {
  const pasta = opcoes.pasta ?? PASTA_DAS_MIGRATIONS;
  const modelo = validarNome(opcoes.modelo ?? BANCO_MODELO);
  const teste = validarNome(opcoes.teste ?? BANCO_DE_TESTE);
  if (admin.database === teste || admin.database === modelo) {
    throw new Error(
      `banco de teste: POSTGRES_DB não pode ser "${admin.database}"; use um banco que não seja ` +
        `${teste} nem ${modelo} (em dev, o do .env)`,
    );
  }
  const hash = hashDasMigrations(pasta);

  const cliente = new pg.Client(admin);
  let erroDaConexao: Error | undefined;
  cliente.on('error', (erro) => {
    erroDaConexao ??= erro;
  });
  await cliente.connect();
  try {
    // Fechar a sessão libera o lock, inclusive se algo abaixo falhar.
    await cliente.query('select pg_advisory_lock($1)', [CHAVE_DO_LOCK]);
    const modeloRefeito = (await comentarioDoBanco(cliente, modelo)) !== PREFIXO_DO_HASH + hash;
    if (modeloRefeito) {
      await refazerModelo(cliente, admin, modelo, pasta, hash);
    }
    const inicio = performance.now();
    await cliente.query(`drop database if exists ${teste} with (force)`);
    await cliente.query(`create database ${teste} template ${modelo}`);
    const msParaRecriar = performance.now() - inicio;
    if (erroDaConexao !== undefined) {
      throw erroDaConexao;
    }
    return { modeloRefeito, hash, msParaRecriar };
  } finally {
    await cliente.end();
  }
}
