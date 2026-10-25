// Integração (Postgres real): esqueleto de `pnpm db:seed` (tarefa 003). Não deixa nada no banco:
// a etapa que escreve é sempre seguida de uma que falha, e a transação é desfeita.
import { randomBytes } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import pg from 'pg';
import { describe, expect, it } from 'vitest';

import { ErroDeConfiguracaoDoBanco } from '../../src/db/conexao.js';
import { ErroDoBanco } from '../../src/db/erros.js';
import {
  descreverFalha,
  ErroNaEtapa,
  ETAPAS,
  type EtapaDoSeed,
  semear,
} from '../../src/db/seed.js';
import { serializarErro } from '../../src/logger/logger.js';
import { ambienteDeTeste } from './ambiente-de-teste.js';

// Com LEILAO_TEST_DB definido, falta de variável derruba a coleta; sem ele, os testes de banco
// são pulados (ambiente-de-teste.ts).
const AMBIENTE = ambienteDeTeste(process.env);
const VALOR_SENSIVEL = 'ana@demo.local';

async function esquemaExiste(nome: string): Promise<boolean> {
  const cliente = new pg.Client(AMBIENTE.conexao());
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

describe('ErroNaEtapa e descreverFalha (sem banco)', () => {
  it('a cause do ErroNaEtapa já vem convertida, sem SQL nem valores', () => {
    const cru = new DrizzleQueryError('insert into users values ($1)', [VALOR_SENSIVEL]);

    const erro = new ErroNaEtapa('contas demo', cru);

    expect(erro.cause).toBeInstanceOf(ErroDoBanco);
    const linhaDeLog = JSON.stringify(serializarErro(erro));
    expect(linhaDeLog).not.toContain(VALOR_SENSIVEL);
    expect(linhaDeLog).not.toContain('insert into');
    expect(descreverFalha(erro)).toBe('etapa "contas demo" falhou: SQLSTATE ?');
  });

  it('descreve a falha de configuração só com os nomes das variáveis', () => {
    const erro = new ErroDeConfiguracaoDoBanco(['DB_PASSWORD']);

    expect(descreverFalha(erro)).toBe(
      'Conexão com o Postgres: variáveis ausentes ou inválidas: DB_PASSWORD',
    );
  });

  it('erro fora de etapa: só o nome, nunca a mensagem', () => {
    expect(descreverFalha(new Error(`falhou com ${VALOR_SENSIVEL}`))).toBe('Error');
  });
});

describe.skipIf(!AMBIENTE.disponivel)('semear (com Postgres)', () => {
  it('sem etapas registradas, não faz nada', async () => {
    expect(ETAPAS).toEqual([]);
    expect(await semear(AMBIENTE.conexao(), ETAPAS, {})).toEqual([]);
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

    const executadas = await semear(AMBIENTE.conexao(), [etapa('a'), etapa('b')], {
      SEED_DEMO_PASSWORD: 'x',
    });

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

    const erro = await semear(AMBIENTE.conexao(), [cria, falha], {}).catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(ErroNaEtapa);
    expect(erro instanceof ErroNaEtapa && erro.etapa).toBe('falha');
    expect(erro instanceof ErroNaEtapa && erro.cause).toBeInstanceOf(ErroDoBanco);
    expect(await esquemaExiste(esquema)).toBe(false);
    const descricao = descreverFalha(erro);
    expect(descricao).toBe('etapa "falha" falhou: SQLSTATE 22P02');
    expect(JSON.stringify(serializarErro(erro))).not.toContain(VALOR_SENSIVEL);
  });
});
