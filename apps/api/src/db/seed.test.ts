// Integração (Postgres real): esqueleto de `pnpm db:seed` (tarefa 003). Não deixa nada no banco:
// a etapa que escreve é sempre seguida de uma que falha, e a transação é desfeita.
import { randomBytes } from 'node:crypto';

import { sql } from 'drizzle-orm';
import pg from 'pg';
import { describe, expect, it } from 'vitest';

import { ErroDeConfiguracao } from '../config/env.js';
import { lerConexaoDoBanco } from './conexao.js';
import { descreverFalha, ErroNaEtapa, ETAPAS, type EtapaDoSeed, semear } from './seed.js';

const CONEXAO = lerConexaoDoBanco(process.env);
const VALOR_SENSIVEL = 'ana@demo.local';

async function esquemaExiste(nome: string): Promise<boolean> {
  const cliente = new pg.Client(CONEXAO);
  await cliente.connect();
  try {
    const { rows } = await cliente.query<{ existe: boolean }>(
      'select to_regnamespace($1) is not null as existe',
      [nome],
    );
    return rows[0]?.existe === true;
  } finally {
    await cliente.end();
  }
}

describe('semear', () => {
  it('sem etapas registradas, não faz nada', async () => {
    expect(ETAPAS).toEqual([]);
    expect(await semear(CONEXAO, ETAPAS, {})).toEqual([]);
  });

  it('roda as etapas em ordem e repassa o env', async () => {
    const vistos: (string | undefined)[] = [];
    const etapa = (nome: string): EtapaDoSeed => ({
      nome,
      executar: async (tx, env) => {
        await tx.execute(sql`select 1`);
        vistos.push(env['SEED_DEMO_PASSWORD']);
      },
    });

    const executadas = await semear(CONEXAO, [etapa('a'), etapa('b')], { SEED_DEMO_PASSWORD: 'x' });

    expect(executadas).toEqual(['a', 'b']);
    expect(vistos).toEqual(['x', 'x']);
  });

  it('desfaz todas as etapas quando uma falha e identifica a etapa', async () => {
    const esquema = `t003_seed_${randomBytes(6).toString('hex')}`;
    const cria: EtapaDoSeed = {
      nome: 'cria',
      executar: async (tx) => {
        await tx.execute(sql.raw(`create schema ${esquema}`));
      },
    };
    const falha: EtapaDoSeed = {
      nome: 'falha',
      executar: async (tx) => {
        await tx.execute(sql`select ${VALOR_SENSIVEL}::uuid`);
      },
    };

    const erro = await semear(CONEXAO, [cria, falha], {}).catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ErroNaEtapa);
    expect((erro as ErroNaEtapa).etapa).toBe('falha');
    expect(await esquemaExiste(esquema)).toBe(false);
    const descricao = descreverFalha(erro);
    expect(descricao).toBe('etapa "falha" falhou: SQLSTATE 22P02');
    expect(descricao).not.toContain(VALOR_SENSIVEL);
  });

  it('descreve a falha de configuração só com os nomes das variáveis', () => {
    const erro = new ErroDeConfiguracao(
      'Conexão com o Postgres: variáveis ausentes ou inválidas: DB_PASSWORD',
    );

    expect(descreverFalha(erro)).toBe(erro.message);
  });
});
