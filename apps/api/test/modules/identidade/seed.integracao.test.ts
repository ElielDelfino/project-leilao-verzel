// Integração (Postgres real): etapa de seed do módulo identidade (specs/003 RF-03, ADR 0027 D14).
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { carregarEtapas, ErroNaEtapa, semear } from '../../../src/db/seed.js';
import { etapasDoSeed } from '../../../src/modules/identidade/seed.js';
import { verificarSenha } from '../../../src/modules/identidade/senha.js';
import {
  type AppDeIdentidade,
  BANCO,
  criarAppDeIdentidade,
  INFRA_DISPONIVEL,
  Navegador,
} from './ambiente.js';

const CONTAS = ['leiloeiro@demo.local', 'helena@demo.local', 'otavio@demo.local'];
const SENHA_DEMO = 'leilao-demo-2026';

async function contasDemo(): Promise<{ email: string; papel: string; senha_hash: string }[]> {
  const cliente = new pg.Client(BANCO.conexao());
  await cliente.connect();
  try {
    const { rows } = await cliente.query<{ email: string; papel: string; senha_hash: string }>(
      'select email::text, papel::text, senha_hash from users where email = any($1) order by email',
      [CONTAS],
    );
    return rows;
  } finally {
    await cliente.end();
  }
}

describe('etapas do seed de identidade (sem banco)', () => {
  it('o db:seed descobre a etapa de identidade', async () => {
    const etapas = await carregarEtapas();

    expect(etapas.map((etapa) => etapa.nome)).toContain(etapasDoSeed[0]?.nome);
  });
});

describe.skipIf(!BANCO.disponivel)('seed de identidade com Postgres real', () => {
  it('rodar duas vezes cria as 3 contas uma vez só, com a senha de SEED_DEMO_PASSWORD', async () => {
    const env = { SEED_DEMO_PASSWORD: SENHA_DEMO };

    await semear(BANCO.conexao(), etapasDoSeed, env);
    const primeira = await contasDemo();
    await semear(BANCO.conexao(), etapasDoSeed, env);
    const segunda = await contasDemo();

    expect(segunda).toEqual(primeira);
    expect(segunda.map((c) => [c.email, c.papel])).toEqual([
      ['helena@demo.local', 'licitante'],
      ['leiloeiro@demo.local', 'leiloeiro'],
      ['otavio@demo.local', 'licitante'],
    ]);
    for (const conta of segunda) {
      expect(await verificarSenha(SENHA_DEMO, conta.senha_hash)).toBe(true);
    }
  });

  it.each([
    ['ausente', {}],
    ['curta', { SEED_DEMO_PASSWORD: 'curta' }],
    ['com caractere fora do alfabeto', { SEED_DEMO_PASSWORD: 'leilao demo 2026' }],
  ])('SEED_DEMO_PASSWORD %s → a etapa falha citando só o nome da variável', async (_, env) => {
    const falha = await semear(BANCO.conexao(), etapasDoSeed, env).catch((e: unknown) => e);

    expect(falha).toBeInstanceOf(ErroNaEtapa);
    const causa = (falha as ErroNaEtapa).cause as Error;
    expect(causa.message).toContain('SEED_DEMO_PASSWORD');
    for (const valor of Object.values(env)) {
      expect(causa.message).not.toContain(valor);
    }
  });
});

describe.skipIf(!INFRA_DISPONIVEL)('login com a conta demo', () => {
  let ctx: AppDeIdentidade;

  beforeAll(async () => {
    await semear(BANCO.conexao(), etapasDoSeed, { SEED_DEMO_PASSWORD: SENHA_DEMO });
    ctx = await criarAppDeIdentidade();
  });

  afterAll(async () => {
    await ctx.fechar();
  });

  it('helena@demo.local entra com leilao-demo-2026', async () => {
    const navegador = new Navegador(ctx.app);
    await navegador.obterCsrf();

    const resposta = await navegador.post('/api/auth/login', {
      email: 'helena@demo.local',
      senha: SENHA_DEMO,
    });

    expect(resposta.statusCode).toBe(200);
    expect(resposta.json()).toMatchObject({ dados: { usuario: { papel: 'licitante' } } });
  });
});
