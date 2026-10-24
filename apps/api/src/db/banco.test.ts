// Integração (Postgres real): cliente compartilhado de banco (tarefa 003). Não grava nada:
// a única escrita (um schema) acontece numa transação que o próprio teste desfaz.
import { randomBytes } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type Banco, criarBanco } from './banco.js';
import { lerConexaoDoBanco } from './conexao.js';
import { ErroDoBanco } from './erros.js';

const CONEXAO = lerConexaoDoBanco(process.env);
const VALOR_SENSIVEL = 'ana@demo.local';

const errosOciosos: unknown[] = [];
let banco: Banco;

beforeAll(() => {
  banco = criarBanco({ conexao: CONEXAO, aoErroOcioso: (erro) => errosOciosos.push(erro) });
});

afterAll(async () => {
  await banco.encerrar();
  expect(errosOciosos).toEqual([]);
});

async function falhaDe(promessa: Promise<unknown>): Promise<unknown> {
  try {
    await promessa;
  } catch (erro: unknown) {
    return erro;
  }
  throw new Error('a operação deveria ter falhado');
}

describe('criarBanco', () => {
  it('consultar devolve o resultado da consulta', async () => {
    const resultado = await banco.consultar((db) => db.execute(sql`select 1 + 1 as soma`));

    expect(resultado.rows).toEqual([{ soma: 2 }]);
  });

  it('consultar converte o erro do driver sem o valor do parâmetro', async () => {
    const erro = await falhaDe(
      banco.consultar((db) => db.execute(sql`select ${VALOR_SENSIVEL}::uuid`)),
    );

    expect(erro).toBeInstanceOf(ErroDoBanco);
    expect((erro as ErroDoBanco).codigo).toBe('22P02');
    expect(JSON.stringify(erro)).not.toContain(VALOR_SENSIVEL);
    expect((erro as ErroDoBanco).message).not.toContain(VALOR_SENSIVEL);
    expect((erro as ErroDoBanco).stack).not.toContain(VALOR_SENSIVEL);
  });

  it('transaction confirma e devolve o valor do callback', async () => {
    const valor = await banco.transaction(async (tx) => {
      const { rows } = await tx.execute(
        sql`select current_setting('transaction_isolation') as nivel`,
      );
      return rows[0];
    });

    expect(valor).toEqual({ nivel: 'read committed' });
  });

  it('transaction desfaz tudo e converte o erro do driver', async () => {
    const esquema = `t003_${randomBytes(6).toString('hex')}`;

    const erro = await falhaDe(
      banco.transaction(async (tx) => {
        await tx.execute(sql.raw(`create schema ${esquema}`));
        await tx.execute(sql`select ${VALOR_SENSIVEL}::uuid`);
      }),
    );

    expect(erro).toBeInstanceOf(ErroDoBanco);
    expect((erro as ErroDoBanco).message).not.toContain(VALOR_SENSIVEL);
    const { rows } = await banco.consultar((db) =>
      db.execute(sql`select to_regnamespace(${esquema}) is null as desfeito`),
    );
    expect(rows).toEqual([{ desfeito: true }]);
  });

  it('transaction repassa sem conversão o erro que não vem do driver', async () => {
    const dominio = new Error('SALDO_INSUFICIENTE');

    const erro = await falhaDe(
      banco.transaction(() => {
        throw dominio;
      }),
    );

    expect(erro).toBe(dominio);
  });
});
