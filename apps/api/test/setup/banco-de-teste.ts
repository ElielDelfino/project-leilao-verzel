// Banco de teste a partir de um modelo (tarefas 011 e 032, specs/013 §"Banco de teste", ADR 0016).
// - O modelo (leilao_test_tpl) é compartilhado por todos os worktrees: recebe as migrations de
//   database/postgres/migrations e guarda o hash da pasta no COMMENT ON DATABASE; só é refeito
//   quando o hash muda (ou falta).
// - Cada worktree tem o seu banco, leilao_test_<sufixo>, apagado e recriado a cada execução com
//   CREATE DATABASE ... TEMPLATE leilao_test_tpl. Nunca se apaga o banco de outro worktree.
// A conexão "admin" é a de POSTGRES_* + DB_PASSWORD (conexao.ts) no banco de dev: é nele que o
// advisory lock é tomado (advisory locks valem por banco). O lock cobre a seção crítica inteira:
// hash, refazer o modelo, esperar o modelo ficar sem conexões, apagar e clonar o banco do worktree.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import pg from 'pg';

import { type ConexaoDoBanco, trocarBanco } from '../../src/db/conexao.js';
import { aplicarMigrations, PASTA_DAS_MIGRATIONS } from '../../src/db/migrate.js';

export const PREFIXO_DOS_BANCOS_DE_TESTE = 'leilao_test';
export const BANCO_MODELO = 'leilao_test_tpl';
const TAMANHO_DO_SUFIXO = 8;

const PREFIXO_DO_HASH = 'migrations-sha256:';
/** Chave do advisory lock do preparo (diferente da das migrations, 3_003_000_001). */
export const CHAVE_DO_LOCK = 3_011_000_001;
/** Espera pelo lock (lock_timeout), como no migrate.ts. */
export const ESPERA_PADRAO_DO_LOCK_MS = 60_000;
/** Espera pelos backends que ainda saem do modelo antes de clonar (senão: SQLSTATE 55006). */
export const ESPERA_PADRAO_DO_MODELO_MS = 15_000;
const INTERVALO_DO_MODELO_MS = 50;
const LOCK_INDISPONIVEL = '55P03';
/** SQLSTATE de CREATE DATABASE ... TEMPLATE com o modelo em uso ("being accessed by other users"). */
const MODELO_EM_USO = '55006';
/** Papel da API (migration 0001): ganha CONNECT nos bancos de teste, como em dev e produção. */
const PAPEL_DA_API = 'leilao_api';
const PREFIXO_COM_SEPARADOR = `${PREFIXO_DOS_BANCOS_DE_TESTE}_`;
/** Nomes que dispensam aspas no Postgres (até 63 bytes). */
const NOME_DE_BANCO = /^[a-z_][a-z0-9_]{0,62}$/;

export interface OpcoesDoBancoDeTeste {
  readonly pasta?: string;
  readonly modelo?: string;
  /** Banco do worktree; padrão: leilao_test_<sufixo do worktree>. */
  readonly teste?: string;
  readonly esperaDoLockMs?: number;
  readonly esperaDoModeloMs?: number;
}

export interface PreparoDoBancoDeTeste {
  /** O modelo foi (re)criado nesta execução: hash diferente, ausente ou modelo inexistente. */
  readonly modeloRefeito: boolean;
  readonly hash: string;
  /** Banco do worktree, recém-clonado do modelo. */
  readonly banco: string;
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

/** Os 8 primeiros hex do SHA-256 dos bytes UTF-8 do caminho, sem nenhuma normalização. */
export function sufixoDoWorktree(caminho: string): string {
  return createHash('sha256').update(caminho, 'utf8').digest('hex').slice(0, TAMANHO_DO_SUFIXO);
}

/** `git rev-parse --show-toplevel` como o git imprime, só sem a quebra de linha final. */
export function caminhoDoWorktree(cwd: string = import.meta.dirname): string {
  try {
    const saida = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return saida.replace(/\n$/, '');
  } catch (erro) {
    const motivo = erro instanceof Error ? erro.message.trim() : String(erro);
    throw new Error(`banco de teste: não consegui descobrir o worktree: ${motivo}`, {
      cause: erro,
    });
  }
}

export function nomeDoBancoDoWorktree(caminho: string = caminhoDoWorktree()): string {
  return `${PREFIXO_DOS_BANCOS_DE_TESTE}_${sufixoDoWorktree(caminho)}`;
}

function validarNome(nome: string): string {
  if (!NOME_DE_BANCO.test(nome)) {
    throw new Error(`banco de teste: nome de banco inválido: ${JSON.stringify(nome)}`);
  }
  return nome;
}

/** Os dois nomes são apagados/recriados: precisam ser de teste e distintos (antes de qualquer DROP). */
function validarNomesDeTeste(modelo: string, teste: string): void {
  for (const [opcao, nome] of [
    ['modelo', modelo],
    ['teste', teste],
  ] as const) {
    if (!nome.startsWith(PREFIXO_COM_SEPARADOR)) {
      throw new Error(
        `banco de teste: "${opcao}" precisa começar com ${PREFIXO_COM_SEPARADOR} (recebi ${JSON.stringify(nome)})`,
      );
    }
  }
  if (modelo === teste) {
    throw new Error('banco de teste: "teste" e "modelo" precisam ser diferentes');
  }
}

function esperaEmTexto(ms: number): string {
  return ms % 1000 === 0 ? `${ms / 1000} s` : `${ms} ms`;
}

const dormir = (ms: number): Promise<void> => new Promise((fim) => setTimeout(fim, ms));

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
  const nome = pg.escapeIdentifier(modelo);
  await cliente.query(`drop database if exists ${nome} with (force)`);
  await cliente.query(`create database ${nome}`);
  await aplicarMigrations(trocarBanco(admin, modelo), { pasta });
  // Sem novas conexões no modelo: uma conexão aberta faz o CREATE DATABASE ... TEMPLATE falhar.
  await cliente.query(`alter database ${nome} with allow_connections false`);
  // Por último: um preparo interrompido deixa o modelo sem hash, e a próxima execução o refaz.
  await cliente.query(
    `comment on database ${nome} is ${pg.escapeLiteral(`${PREFIXO_DO_HASH}${hash}`)}`,
  );
}

/**
 * Espera os backends saírem do modelo: o `end()` do cliente de migrations resolve antes de o
 * backend terminar, e o CREATE DATABASE ... TEMPLATE falha (55006) com qualquer conexão nele.
 */
async function esperarModeloSemConexoes(
  cliente: pg.Client,
  modelo: string,
  esperaMs: number,
): Promise<void> {
  const limite = performance.now() + esperaMs;
  for (;;) {
    const { rows } = await cliente.query<{ total: string }>(
      'select count(*) as total from pg_stat_activity where datname = $1',
      [modelo],
    );
    const conexoes = Number(rows[0]?.total);
    if (conexoes === 0) {
      return;
    }
    if (performance.now() >= limite) {
      throw new Error(
        `banco de teste: ${conexoes} conexão(ões) aberta(s) em ${modelo} depois de ` +
          `${esperaEmTexto(esperaMs)} (psql, DBeaver?); feche-as e tente de novo`,
      );
    }
    await dormir(INTERVALO_DO_MODELO_MS);
  }
}

/**
 * Recria `teste` a partir de `modelo`. O autovacuum ignora `datallowconn` e pode entrar no modelo
 * entre a contagem de conexões e o CREATE: só o CREATE é repetido em 55006, até `esperaMs`.
 * O `cliente` só precisa de `query`.
 */
export async function clonarDoModelo(
  cliente: { query: (texto: string) => Promise<unknown> },
  teste: string,
  modelo: string,
  esperaMs: number,
): Promise<void> {
  const nomeTeste = pg.escapeIdentifier(teste);
  const nomeModelo = pg.escapeIdentifier(modelo);
  await cliente.query(`drop database if exists ${nomeTeste} with (force)`);
  const limite = performance.now() + esperaMs;
  for (;;) {
    try {
      await cliente.query(`create database ${nomeTeste} template ${nomeModelo}`);
      break;
    } catch (erro) {
      if ((erro as { code?: unknown }).code !== MODELO_EM_USO) {
        throw erro;
      }
      if (performance.now() >= limite) {
        throw new Error(
          `banco de teste: ${modelo} ainda tem conexões depois de ${esperaEmTexto(esperaMs)} ` +
            '(autovacuum, psql?); tente de novo',
          { cause: erro },
        );
      }
      await dormir(INTERVALO_DO_MODELO_MS);
    }
  }
  // O CREATE ... TEMPLATE não copia o datacl: repete os privilégios da migration 0001.
  await cliente.query(`revoke temporary on database ${nomeTeste} from public`);
  await cliente.query(`revoke connect on database ${nomeTeste} from public`);
  await cliente.query(
    `grant connect on database ${nomeTeste} to ${pg.escapeIdentifier(PAPEL_DA_API)}`,
  );
}

async function tomarOLock(cliente: pg.Client, esperaMs: number, modelo: string): Promise<void> {
  await cliente.query("select set_config('lock_timeout', $1, false)", [
    String(Math.trunc(esperaMs)),
  ]);
  try {
    await cliente.query('select pg_advisory_lock($1)', [CHAVE_DO_LOCK]);
  } catch (erro) {
    if ((erro as { code?: unknown }).code === LOCK_INDISPONIVEL) {
      throw new Error(
        `lock do banco de teste não obtido em ${esperaEmTexto(esperaMs)}: outra execução está ` +
          `preparando ${modelo}; tente de novo`,
        { cause: erro },
      );
    }
    throw erro;
  }
  await cliente.query('reset lock_timeout');
}

/**
 * Garante o modelo em dia com as migrations e recria o banco do worktree a partir dele.
 * `admin` é o banco de dev; não pode ser o modelo nem nenhum leilao_test_* (são apagados).
 * Duas execuções simultâneas no mesmo worktree não são suportadas (specs/013).
 */
export async function prepararBancoDeTeste(
  admin: ConexaoDoBanco,
  opcoes: OpcoesDoBancoDeTeste = {},
): Promise<PreparoDoBancoDeTeste> {
  if (admin.database.startsWith(PREFIXO_DOS_BANCOS_DE_TESTE)) {
    throw new Error(
      `POSTGRES_DB não pode ser um banco de teste (${PREFIXO_DOS_BANCOS_DE_TESTE}*): ` +
        'use o banco de dev',
    );
  }
  const pasta = opcoes.pasta ?? PASTA_DAS_MIGRATIONS;
  const modelo = validarNome(opcoes.modelo ?? BANCO_MODELO);
  const teste = validarNome(opcoes.teste ?? nomeDoBancoDoWorktree());
  validarNomesDeTeste(modelo, teste);
  const esperaDoLock = opcoes.esperaDoLockMs ?? ESPERA_PADRAO_DO_LOCK_MS;
  // lock_timeout = 0 desliga o timeout: o preparo esperaria para sempre.
  if (!Number.isInteger(esperaDoLock) || esperaDoLock < 1) {
    throw new Error('banco de teste: esperaDoLockMs precisa ser um inteiro >= 1');
  }
  const esperaDoModelo = opcoes.esperaDoModeloMs ?? ESPERA_PADRAO_DO_MODELO_MS;

  const cliente = new pg.Client(admin);
  let erroDaConexao: Error | undefined;
  cliente.on('error', (erro) => {
    erroDaConexao ??= erro;
  });
  await cliente.connect();
  try {
    // Sem pg_advisory_unlock: o lock é de sessão e o cliente.end() do finally o libera, inclusive
    // se algo abaixo falhar.
    await tomarOLock(cliente, esperaDoLock, modelo);
    // O hash depois do lock: quem esperava pode ter outra visão da pasta de migrations.
    const hash = hashDasMigrations(pasta);
    const modeloRefeito = (await comentarioDoBanco(cliente, modelo)) !== PREFIXO_DO_HASH + hash;
    if (modeloRefeito) {
      await refazerModelo(cliente, admin, modelo, pasta, hash);
    }
    await esperarModeloSemConexoes(cliente, modelo, esperaDoModelo);
    const inicio = performance.now();
    await clonarDoModelo(cliente, teste, modelo, esperaDoModelo);
    const msParaRecriar = performance.now() - inicio;
    if (erroDaConexao !== undefined) {
      throw erroDaConexao;
    }
    return { modeloRefeito, hash, banco: teste, msParaRecriar };
  } finally {
    // Um erro ao fechar não pode mascarar o erro original (conexão já caída, por exemplo).
    await cliente.end().catch(() => undefined);
  }
}
