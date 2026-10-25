// Setup global dos testes da API (tarefa 011, specs/013): com LEILAO_TEST_DB=local, os testes
// enxergam POSTGRES_DB=leilao_test, recriado a partir do leilao_test_tpl antes da coleta.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import pg from 'pg';
import { describe, expect, it } from 'vitest';

import { ambienteDeTeste } from '../db/ambiente-de-teste.js';
import { PASTA_DAS_MIGRATIONS } from '../../src/db/migrate.js';
import { BANCO_DE_TESTE } from './banco-de-teste.js';
import { bancoDeTesteDoAmbiente } from './global.js';

const AMBIENTE = ambienteDeTeste(process.env);
const LOCAL = process.env['LEILAO_TEST_DB'] === 'local';

function quantidadeDeMigrations(): number {
  const diario = JSON.parse(
    readFileSync(join(PASTA_DAS_MIGRATIONS, 'meta', '_journal.json'), 'utf8'),
  ) as { readonly entries: readonly unknown[] };
  return diario.entries.length;
}

describe('bancoDeTesteDoAmbiente', () => {
  it('sem LEILAO_TEST_DB não prepara banco (só os testes de unidade rodam)', () => {
    expect(bancoDeTesteDoAmbiente({})).toBeUndefined();
    expect(bancoDeTesteDoAmbiente({ LEILAO_TEST_DB: '' })).toBeUndefined();
  });

  it('LEILAO_TEST_DB=local usa o Postgres local já no ar', () => {
    expect(bancoDeTesteDoAmbiente({ LEILAO_TEST_DB: 'local' })).toBe('local');
  });

  it('recusa um valor desconhecido em vez de rodar sem banco', () => {
    expect(() => bancoDeTesteDoAmbiente({ LEILAO_TEST_DB: 'ci' })).toThrow(
      'LEILAO_TEST_DB="ci" não é suportado',
    );
  });
});

describe.skipIf(!LOCAL || !AMBIENTE.disponivel)('com LEILAO_TEST_DB=local', () => {
  it('os testes conectam no leilao_test, com as migrations do modelo aplicadas', async () => {
    const cliente = new pg.Client(AMBIENTE.conexao());
    await cliente.connect();
    try {
      const { rows } = await cliente.query<{ banco: string; migrations: string }>(
        `select current_database() as banco,
                (select count(*) from drizzle.__drizzle_migrations) as migrations`,
      );

      expect(process.env['POSTGRES_DB']).toBe(BANCO_DE_TESTE);
      expect(rows[0]?.banco).toBe(BANCO_DE_TESTE);
      expect(Number(rows[0]?.migrations)).toBe(quantidadeDeMigrations());
    } finally {
      await cliente.end();
    }
  });
});
