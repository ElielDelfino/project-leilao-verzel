import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// specs/001 §Módulos da API: o eslint.config.mjs REAL barra aresta fora da ordem de dependência,
// import que não passa pelo index.ts, ciclo e pasta de modules/ fora da tabela. Os casos são
// avaliados em memória (lintText com caminho virtual); só o módulo fora do catálogo precisa de uma
// pasta real, criada e removida pelo próprio teste.
const RAIZ = resolve(fileURLToPath(new URL('../../../..', import.meta.url)));
const MODULOS = join(RAIZ, 'apps/api/src/modules');
const NAO_CATALOGADO = `zz-fixture-013-${String(process.pid)}`;
const REGRA = 'boundaries/dependencies';
const BASE = 'apps/api/src/modules';

const eslint = new ESLint({ cwd: RAIZ });

interface Analise {
  regra: string[];
  ignorado: boolean;
  fatais: string[];
}

async function analisar(arquivo: string, codigo: string): Promise<Analise> {
  const [resultado] = await eslint.lintText(`${codigo}\nexport const usa = x;\n`, {
    filePath: join(RAIZ, arquivo),
  });
  const mensagens = resultado?.messages ?? [];
  return {
    regra: mensagens.filter((m) => m.ruleId === REGRA).map((m) => m.message),
    ignorado: mensagens.some((m) => /file ignored/i.test(m.message)),
    fatais: mensagens.filter((m) => m.fatal === true).map((m) => m.message),
  };
}

async function violacoes(arquivo: string, codigo: string): Promise<string[]> {
  return (await analisar(arquivo, codigo)).regra;
}

/** O caso passou de fato pelo eslint real: sem arquivo ignorado, sem erro fatal, sem violação. */
async function afirmarPermitido(arquivo: string, codigo: string): Promise<void> {
  const analise = await analisar(arquivo, codigo);
  expect(analise.ignorado).toBe(false);
  expect(analise.fatais).toEqual([]);
  expect(analise.regra).toEqual([]);
}

const imp = (alvo: string): string => `import { a as x } from '${alvo}';`;
const impTipo = (alvo: string): string => `import type { A as x } from '${alvo}';`;

// Espelho único de specs/001 §Módulos da API, tabela "Importa". Mude aqui junto com a spec.
const MODULOS_DA_API = [
  'identidade',
  'carteira',
  'catalogo',
  'lotes',
  'lances',
  'liquidacao',
  'tempo-real',
] as const;
type Modulo = (typeof MODULOS_DA_API)[number];
const IMPORTA: Record<Modulo, readonly Modulo[]> = {
  identidade: [],
  carteira: [],
  catalogo: [],
  lotes: ['catalogo'],
  lances: ['lotes', 'carteira', 'catalogo', 'identidade'],
  liquidacao: ['lances', 'lotes', 'carteira', 'catalogo'],
  'tempo-real': ['lotes', 'lances', 'identidade'],
};

// Matriz 7x7 gerada da tabela: [origem, import, descrição]. A diagonal (mesmo módulo) não é
// checada pela regra.
const MATRIZ = MODULOS_DA_API.flatMap((origem) =>
  MODULOS_DA_API.map((destino) => {
    const permitida = origem === destino || IMPORTA[origem].includes(destino);
    const alvo = origem === destino ? './index.js' : `../${destino}/index.js`;
    return { origem, alvo, permitida, descricao: `${origem} → ${destino}` };
  }),
);
const PERMITIDOS = MATRIZ.filter((c) => c.permitida).map((c) => [c.origem, c.alvo, c.descricao]);
const PROIBIDOS = MATRIZ.filter((c) => !c.permitida).map((c) => [c.origem, c.alvo, c.descricao]);

// Formas de import permitidas que a matriz não cobre.
const PERMITIDOS_EXTRAS: [string, string, string][] = [
  ['lances', '../lotes/index', 'import sem extensão pelo index'],
  ['lances', '../carteira', 'import da pasta (resolve para o index.ts)'],
];

// Aresta permitida (ou não), mas apontando para dentro do módulo e não para o index.ts.
const FORA_DO_INDEX: [string, string, string][] = [
  ['lances', '../carteira/servico-de-carteira.js', 'arquivo interno com extensão'],
  ['lances', '../carteira/servico-de-carteira', 'arquivo interno sem extensão'],
  ['lances', '../carteira/repositorio.js', 'repositório de outro módulo'],
  ['lotes', '../catalogo/catalogo.module.js', 'aresta permitida, mas fora do index.ts'],
];

describe('fronteiras entre módulos da API (specs/001 §Módulos da API)', { timeout: 60_000 }, () => {
  beforeAll(() => {
    // Sobras de uma execução morta por SIGKILL (o afterAll não roda) viram "módulo fora do catálogo".
    for (const pasta of readdirSync(MODULOS).filter((n) => n.startsWith('zz-fixture-013-'))) {
      rmSync(join(MODULOS, pasta), { recursive: true, force: true });
    }
    mkdirSync(join(MODULOS, NAO_CATALOGADO), { recursive: true });
    writeFileSync(join(MODULOS, NAO_CATALOGADO, 'index.ts'), 'export const a = 1;\n');
  });
  afterAll(() => {
    rmSync(join(MODULOS, NAO_CATALOGADO), { recursive: true, force: true });
  });

  it('a matriz cobre os 49 pares e a tabela de specs/001 (12 arestas)', () => {
    expect(MATRIZ).toHaveLength(49);
    expect(Object.values(IMPORTA).flat()).toHaveLength(12);
    expect(PROIBIDOS).toHaveLength(49 - 7 - 12);
  });

  it.each([...PERMITIDOS, ...PERMITIDOS_EXTRAS])(
    'permite %s importando %s (%s)',
    async (origem, alvo) => {
      await afirmarPermitido(`${BASE}/${origem}/caso.ts`, imp(alvo));
    },
  );

  it('um arquivo ignorado seria detectado (guarda do próprio teste)', async () => {
    const analise = await analisar('node_modules/x/caso.ts', imp('./a.js'));
    expect(analise.ignorado).toBe(true);
  });

  it.each(PROIBIDOS)('barra %s importando %s (%s)', async (origem, alvo) => {
    expect((await violacoes(`${BASE}/${origem}/caso.ts`, imp(alvo))).length).toBeGreaterThan(0);
  });

  it.each(FORA_DO_INDEX)('barra %s importando %s (%s)', async (origem, alvo) => {
    expect((await violacoes(`${BASE}/${origem}/caso.ts`, imp(alvo))).length).toBeGreaterThan(0);
  });

  it('aplica a regra também a import type', async () => {
    const foraDaTabela = await violacoes(`${BASE}/carteira/c.ts`, impTipo('../lances/index.js'));
    const foraDoIndex = await violacoes(
      `${BASE}/lances/c.ts`,
      impTipo('../carteira/repositorio.js'),
    );
    const permitido = await violacoes(`${BASE}/lances/c.ts`, impTipo('../carteira/index.js'));
    expect(foraDaTabela.length).toBeGreaterThan(0);
    expect(foraDoIndex.length).toBeGreaterThan(0);
    expect(permitido).toEqual([]);
  });

  it('não checa import dentro do mesmo módulo', async () => {
    expect(await violacoes(`${BASE}/lances/caso.ts`, imp('./lances.module.js'))).toEqual([]);
  });

  it('não checa common/ nem pacotes externos', async () => {
    expect(await violacoes(`${BASE}/lances/caso.ts`, imp('../../common/envelope.js'))).toEqual([]);
    expect(await violacoes(`${BASE}/lotes/caso.ts`, imp('node:path'))).toEqual([]);
  });

  it('código de src/ fora de modules/ não é origem checada (specs/001: só modules/)', async () => {
    expect(await violacoes('apps/api/src/caso.ts', imp('./modules/lances/index.js'))).toEqual([]);
    const interno = imp('./modules/lances/lances.module.js');
    expect(await violacoes('apps/api/src/caso.ts', interno)).toEqual([]);
  });

  it('teste importando internals de um módulo não é barrado (só src/modules/ é origem)', async () => {
    const codigo = imp('../src/modules/lances/lances.module.js');
    expect(await violacoes('apps/api/test/caso.test.ts', codigo)).toEqual([]);
  });

  it('módulo fora do catálogo não importa nem é importado', async () => {
    const dele = await violacoes(`${BASE}/${NAO_CATALOGADO}/caso.ts`, imp('../carteira/index.js'));
    const para = await violacoes(`${BASE}/lances/caso.ts`, imp(`../${NAO_CATALOGADO}/index.js`));
    expect(dele.length).toBeGreaterThan(0);
    expect(para.length).toBeGreaterThan(0);
  });
});
