// Banco de teste a partir de um modelo (tarefa 011, specs/013 §"pnpm verify:quick"): o modelo
// recebe as migrations e só é refeito quando o hash da pasta muda (hash no COMMENT ON DATABASE);
// o banco de teste é recriado a cada execução com CREATE DATABASE ... TEMPLATE.
//
// Os testes usam nomes próprios (leilao_t011_<hex>) e uma cópia da pasta de migrations, então não
// mexem no leilao_test nem no leilao_test_tpl de quem estiver rodando o verify.
import { randomBytes } from 'node:crypto';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ambienteDeTeste } from '../../src/db/ambiente-de-teste.js';
import { type ConexaoDoBanco, trocarBanco } from '../../src/db/conexao.js';
import { PASTA_DAS_MIGRATIONS } from '../../src/db/migrate.js';
import {
  BANCO_DE_TESTE,
  BANCO_MODELO,
  hashDasMigrations,
  prepararBancoDeTeste,
} from './banco-de-teste.js';

const AMBIENTE = ambienteDeTeste(process.env);
const SUFIXO = randomBytes(5).toString('hex');
const MODELO = `leilao_t011_${SUFIXO}_tpl`;
const TESTE = `leilao_t011_${SUFIXO}`;
const HASH_SHA256 = /^[0-9a-f]{64}$/;

/** Critério de aceite da tarefa 011: recriar o banco de teste a partir do modelo leva < 1 s. */
const LIMITE_PARA_RECRIAR_MS = 1000;

/** Cópia descartável da pasta de migrations, para simular uma migration nova. */
function copiarMigrations(): string {
  const destino = mkdtempSync(join(tmpdir(), 'leilao-t011-'));
  cpSync(PASTA_DAS_MIGRATIONS, destino, { recursive: true });
  return destino;
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

interface EstadoDoBanco {
  readonly comentario: string | null;
  readonly aceitaConexoes: boolean;
}

async function estadoDoBanco(nome: string): Promise<EstadoDoBanco | undefined> {
  return comCliente(AMBIENTE.conexao(), async (cliente) => {
    const { rows } = await cliente.query<{ comentario: string | null; conexoes: boolean }>(
      `select shobj_description(oid, 'pg_database') as comentario, datallowconn as conexoes
         from pg_database where datname = $1`,
      [nome],
    );
    const linha = rows[0];
    return linha && { comentario: linha.comentario, aceitaConexoes: linha.conexoes };
  });
}

async function migrationsAplicadas(nome: string): Promise<number> {
  return comCliente(trocarBanco(AMBIENTE.conexao(), nome), async (cliente) => {
    const { rows } = await cliente.query<{ total: string }>(
      'select count(*) as total from drizzle.__drizzle_migrations',
    );
    return Number(rows[0]?.total);
  });
}

describe('hashDasMigrations', () => {
  it('é o SHA-256 em hex e não muda entre leituras da mesma pasta', () => {
    const hash = hashDasMigrations(PASTA_DAS_MIGRATIONS);

    expect(hash).toMatch(HASH_SHA256);
    expect(hashDasMigrations(PASTA_DAS_MIGRATIONS)).toBe(hash);
  });

  it('muda quando o conteúdo de uma migration muda', () => {
    const pasta = copiarMigrations();
    try {
      const antes = hashDasMigrations(pasta);
      writeFileSync(join(pasta, '0000_base.sql'), '-- alterada\n', { flag: 'a' });

      expect(hashDasMigrations(pasta)).not.toBe(antes);
    } finally {
      rmSync(pasta, { recursive: true, force: true });
    }
  });

  it('muda quando entra um arquivo novo, inclusive em meta/', () => {
    const pasta = copiarMigrations();
    try {
      const antes = hashDasMigrations(pasta);
      writeFileSync(join(pasta, 'meta', 'extra.json'), '{}');
      const comMeta = hashDasMigrations(pasta);
      writeFileSync(join(pasta, '0001_nova.sql'), 'select 1;\n');

      expect(comMeta).not.toBe(antes);
      expect(hashDasMigrations(pasta)).not.toBe(comMeta);
    } finally {
      rmSync(pasta, { recursive: true, force: true });
    }
  });

  it('muda quando um arquivo troca de nome, mesmo com o mesmo conteúdo', () => {
    const a = copiarMigrations();
    const b = copiarMigrations();
    try {
      writeFileSync(join(a, 'x.sql'), 'select 1;\n');
      writeFileSync(join(b, 'y.sql'), 'select 1;\n');

      expect(hashDasMigrations(a)).not.toBe(hashDasMigrations(b));
    } finally {
      rmSync(a, { recursive: true, force: true });
      rmSync(b, { recursive: true, force: true });
    }
  });
});

describe('prepararBancoDeTeste (sem banco)', () => {
  it('usa leilao_test e leilao_test_tpl por padrão (specs/013)', () => {
    expect(BANCO_DE_TESTE).toBe('leilao_test');
    expect(BANCO_MODELO).toBe('leilao_test_tpl');
  });
});

describe.skipIf(!AMBIENTE.disponivel)('prepararBancoDeTeste (com Postgres)', () => {
  const pasta = copiarMigrations();
  const opcoes = { pasta, modelo: MODELO, teste: TESTE };

  beforeAll(async () => {
    // Estado inicial conhecido: nem modelo nem banco de teste.
    await comCliente(AMBIENTE.conexao(), async (cliente) => {
      await cliente.query(`drop database if exists ${TESTE} with (force)`);
      await cliente.query(`drop database if exists ${MODELO} with (force)`);
    });
  });

  afterAll(async () => {
    await comCliente(AMBIENTE.conexao(), async (cliente) => {
      await cliente.query(`drop database if exists ${TESTE} with (force)`);
      await cliente.query(`drop database if exists ${MODELO} with (force)`);
    });
    rmSync(pasta, { recursive: true, force: true });
  });

  it('sem modelo: cria o modelo com as migrations, grava o hash e cria o banco de teste', async () => {
    const resultado = await prepararBancoDeTeste(AMBIENTE.conexao(), opcoes);

    expect(resultado.modeloRefeito).toBe(true);
    expect(resultado.hash).toBe(hashDasMigrations(pasta));
    expect(await estadoDoBanco(MODELO)).toEqual({
      comentario: `migrations-sha256:${hashDasMigrations(pasta)}`,
      // Ninguém conecta no modelo: uma conexão aberta faria o CREATE DATABASE ... TEMPLATE falhar.
      aceitaConexoes: false,
    });
    expect(await migrationsAplicadas(TESTE)).toBe(1);
  });

  it('com o mesmo hash: reaproveita o modelo e recria o banco de teste do zero', async () => {
    await comCliente(trocarBanco(AMBIENTE.conexao(), TESTE), (cliente) =>
      cliente.query('create table sobra_da_execucao_anterior (id int)'),
    );

    const resultado = await prepararBancoDeTeste(AMBIENTE.conexao(), opcoes);

    expect(resultado.modeloRefeito).toBe(false);
    const sobra = await comCliente(trocarBanco(AMBIENTE.conexao(), TESTE), async (cliente) => {
      const { rows } = await cliente.query<{ existe: boolean }>(
        `select to_regclass('public.sobra_da_execucao_anterior') is not null as existe`,
      );
      return rows[0]?.existe;
    });
    expect(sobra).toBe(false);
    expect(await migrationsAplicadas(TESTE)).toBe(1);
  });

  it(`recria o banco de teste a partir do modelo em menos de ${LIMITE_PARA_RECRIAR_MS} ms`, async () => {
    const resultado = await prepararBancoDeTeste(AMBIENTE.conexao(), opcoes);

    expect(resultado.modeloRefeito).toBe(false);
    expect(resultado.msParaRecriar).toBeLessThan(LIMITE_PARA_RECRIAR_MS);
  });

  it('com uma migration nova: refaz o modelo, aplica a nova e troca o hash', async () => {
    writeFileSync(join(pasta, '0001_t011.sql'), 'create table marca_t011 (id int primary key);\n');
    // O migrator do Drizzle só aplica o que está no diário.
    const diario = join(pasta, 'meta', '_journal.json');
    writeFileSync(
      diario,
      JSON.stringify({
        version: '7',
        dialect: 'postgresql',
        entries: [
          { idx: 0, version: '7', when: 1792877302279, tag: '0000_base', breakpoints: true },
          { idx: 1, version: '7', when: 1792877302280, tag: '0001_t011', breakpoints: true },
        ],
      }),
    );

    const resultado = await prepararBancoDeTeste(AMBIENTE.conexao(), opcoes);

    expect(resultado.modeloRefeito).toBe(true);
    expect((await estadoDoBanco(MODELO))?.comentario).toBe(
      `migrations-sha256:${hashDasMigrations(pasta)}`,
    );
    expect(await migrationsAplicadas(TESTE)).toBe(2);
  });

  it('modelo sem comentário (preparo interrompido antes do fim) é refeito', async () => {
    await comCliente(AMBIENTE.conexao(), (cliente) =>
      cliente.query(`comment on database ${MODELO} is null`),
    );

    const resultado = await prepararBancoDeTeste(AMBIENTE.conexao(), opcoes);

    expect(resultado.modeloRefeito).toBe(true);
    expect((await estadoDoBanco(MODELO))?.comentario).toBe(
      `migrations-sha256:${hashDasMigrations(pasta)}`,
    );
  });

  it('duas execuções simultâneas terminam as duas, com o banco de teste íntegro', async () => {
    await Promise.all([
      prepararBancoDeTeste(AMBIENTE.conexao(), opcoes),
      prepararBancoDeTeste(AMBIENTE.conexao(), opcoes),
    ]);

    expect(await migrationsAplicadas(TESTE)).toBe(2);
  });

  it('recusa conectar pelo próprio banco de teste ou pelo modelo', async () => {
    await expect(
      prepararBancoDeTeste(trocarBanco(AMBIENTE.conexao(), TESTE), opcoes),
    ).rejects.toThrow(`POSTGRES_DB não pode ser "${TESTE}"`);
    await expect(
      prepararBancoDeTeste(trocarBanco(AMBIENTE.conexao(), MODELO), opcoes),
    ).rejects.toThrow(`POSTGRES_DB não pode ser "${MODELO}"`);
  });

  it('recusa nome de banco fora de [a-z0-9_]', async () => {
    await expect(
      prepararBancoDeTeste(AMBIENTE.conexao(), { ...opcoes, teste: 'leilao-test"; drop' }),
    ).rejects.toThrow('nome de banco inválido');
  });
});
