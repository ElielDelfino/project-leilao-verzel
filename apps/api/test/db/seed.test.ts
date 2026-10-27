// Integração (Postgres real): esqueleto de `pnpm db:seed` (tarefa 003). Não deixa nada no banco:
// a etapa que escreve é sempre seguida de uma que falha, e a transação é desfeita.
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { sql } from 'drizzle-orm';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import { ErroDeConfiguracaoDoBanco } from '../../src/db/conexao.js';
import { ErroDoBanco } from '../../src/db/erros.js';
import {
  carregarEtapas,
  descreverFalha,
  ErroDoSeedDoModulo,
  ErroNaEtapa,
  type EtapaDoSeed,
  ORDEM_DOS_MODULOS,
  semear,
} from '../../src/db/seed.js';
import { serializarErro } from '../../src/logger/logger.js';
import { ambienteDeTeste } from './ambiente-de-teste.js';

// Com LEILAO_TEST_DB definido, falta de variável derruba a coleta; sem ele, os testes de banco
// são pulados (ambiente-de-teste.ts).
const AMBIENTE = ambienteDeTeste(process.env);
const VALOR_SENSIVEL = 'helena@demo.local';

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

describe('carregarEtapas (D14 da tarefa 036)', () => {
  const pasta = mkdtempSync(join(tmpdir(), 'leilao-t037-seed-'));
  const EXTENSAO = '.mjs';

  /** Um seed de módulo de teste, em JS puro (o carregador só faz import dinâmico). */
  function seedDoModulo(modulo: string, conteudo: string): void {
    mkdirSync(join(pasta, modulo), { recursive: true });
    writeFileSync(join(pasta, modulo, `seed${EXTENSAO}`), conteudo);
  }

  const etapas = (...nomes: string[]): string =>
    `export const etapasDoSeed = [${nomes
      .map((nome) => `{ nome: ${JSON.stringify(nome)}, executar: async () => {} }`)
      .join(', ')}];\n`;

  afterAll(() => {
    rmSync(pasta, { recursive: true, force: true });
  });

  it('a ordem dos módulos é a de specs/001 §Módulos', () => {
    expect(ORDEM_DOS_MODULOS).toEqual([
      'identidade',
      'carteira',
      'catalogo',
      'lotes',
      'lances',
      'tempo-real',
      'liquidacao',
    ]);
  });

  it('pasta de módulos sem nenhum seed, devolve []', async () => {
    const vazia = mkdtempSync(join(tmpdir(), 'leilao-t037-seed-'));
    try {
      for (const modulo of ORDEM_DOS_MODULOS) {
        mkdirSync(join(vazia, modulo));
      }

      expect(await carregarEtapas(vazia, EXTENSAO)).toEqual([]);
    } finally {
      rmSync(vazia, { recursive: true, force: true });
    }
  });

  it('a pasta padrão é src/modules (as etapas reais são carregadas sem erro)', async () => {
    const etapas = await carregarEtapas();

    expect(etapas.every((etapa) => typeof etapa.nome === 'string')).toBe(true);
  });

  it.each([
    ['módulo inexistente', "import './nao-existe.mjs';\n", 'ERR_MODULE_NOT_FOUND'],
    ['erro de sintaxe', 'export const = segredo-que-nao-pode-aparecer;\n', 'sem código'],
  ])(
    'falha no import do seed (%s): cita o módulo e o código, nunca a mensagem',
    async (_caso, conteudo, codigo) => {
      const outra = mkdtempSync(join(tmpdir(), 'leilao-t037-seed-'));
      try {
        mkdirSync(join(outra, 'lotes'));
        writeFileSync(join(outra, 'lotes', `seed${EXTENSAO}`), conteudo);

        const erro = await carregarEtapas(outra, EXTENSAO).catch((e: unknown) => e);

        expect(erro).toBeInstanceOf(ErroDoSeedDoModulo);
        expect(descreverFalha(erro)).toBe(`modules/lotes/seed.mjs: falha ao importar (${codigo})`);
        expect(erro instanceof Error && erro.cause).toBeUndefined();
        expect(JSON.stringify(serializarErro(erro))).not.toContain('segredo-que-nao-pode-aparecer');
        expect(JSON.stringify(serializarErro(erro))).not.toContain(outra);
      } finally {
        rmSync(outra, { recursive: true, force: true });
      }
    },
  );

  it('carrega as etapas na ordem de specs/001, não na alfabética nem na de criação', async () => {
    seedDoModulo('liquidacao', etapas('liquidacao:1'));
    seedDoModulo('carteira', etapas('carteira:1', 'carteira:2'));
    seedDoModulo('identidade', etapas('identidade:1'));
    seedDoModulo('lotes', etapas());

    const nomes = (await carregarEtapas(pasta, EXTENSAO)).map((etapa) => etapa.nome);

    expect(nomes).toEqual(['identidade:1', 'carteira:1', 'carteira:2', 'liquidacao:1']);
  });

  it('seed.ts sem etapasDoSeed válido falha citando o módulo', async () => {
    const outra = mkdtempSync(join(tmpdir(), 'leilao-t037-seed-'));
    try {
      mkdirSync(join(outra, 'catalogo'));
      writeFileSync(join(outra, 'catalogo', `seed${EXTENSAO}`), 'export const etapas = [];\n');

      const erro = await carregarEtapas(outra, EXTENSAO).catch((e: unknown) => e);

      expect(erro).toBeInstanceOf(ErroDoSeedDoModulo);
      expect(descreverFalha(erro)).toBe(
        'modules/catalogo/seed.mjs: exporte etapasDoSeed como lista de {nome, executar}',
      );
    } finally {
      rmSync(outra, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!AMBIENTE.disponivel)('semear (com Postgres)', () => {
  it('sem etapas, não faz nada', async () => {
    expect(await semear(AMBIENTE.conexao(), [], {})).toEqual([]);
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
