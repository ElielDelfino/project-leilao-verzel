import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
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

async function violacoes(arquivo: string, codigo: string): Promise<string[]> {
  const [resultado] = await eslint.lintText(`${codigo}\nexport const usa = x;\n`, {
    filePath: join(RAIZ, arquivo),
  });
  return (resultado?.messages ?? []).filter((m) => m.ruleId === REGRA).map((m) => m.message);
}

const imp = (alvo: string): string => `import { a as x } from '${alvo}';`;
const impTipo = (alvo: string): string => `import type { A as x } from '${alvo}';`;

// [origem, import, descrição]: arestas permitidas (specs/001, tabela "Importa").
const PERMITIDOS: [string, string, string][] = [
  ['lotes', '../catalogo/index.js', 'lotes → catalogo'],
  ['lances', '../lotes/index.js', 'lances → lotes'],
  ['lances', '../carteira/index.js', 'lances → carteira'],
  ['lances', '../catalogo/index.js', 'lances → catalogo'],
  ['lances', '../identidade/index.js', 'lances → identidade'],
  ['liquidacao', '../lances/index.js', 'liquidacao → lances'],
  ['liquidacao', '../lotes/index.js', 'liquidacao → lotes'],
  ['liquidacao', '../carteira/index.js', 'liquidacao → carteira'],
  ['liquidacao', '../catalogo/index.js', 'liquidacao → catalogo'],
  ['tempo-real', '../lotes/index.js', 'tempo-real → lotes'],
  ['tempo-real', '../lances/index.js', 'tempo-real → lances'],
  ['tempo-real', '../identidade/index.js', 'tempo-real → identidade'],
  ['lances', '../lotes/index', 'import sem extensão pelo index'],
  ['lances', '../carteira', 'import da pasta (resolve para o index.ts)'],
];

// Arestas fora da tabela, inclusive ciclos.
const PROIBIDOS: [string, string, string][] = [
  ['lotes', '../lances/index.js', 'lotes → lances (ciclo)'],
  ['lotes', '../carteira/index.js', 'lotes → carteira'],
  ['carteira', '../lances/index.js', 'carteira → lances'],
  ['identidade', '../carteira/index.js', 'identidade → carteira'],
  ['catalogo', '../lotes/index.js', 'catalogo → lotes'],
  ['lances', '../liquidacao/index.js', 'lances → liquidacao (ciclo)'],
  ['lances', '../tempo-real/index.js', 'lances → tempo-real'],
  ['tempo-real', '../carteira/index.js', 'tempo-real → carteira'],
  ['tempo-real', '../liquidacao/index.js', 'tempo-real → liquidacao'],
  ['liquidacao', '../identidade/index.js', 'liquidacao → identidade'],
  ['liquidacao', '../tempo-real/index.js', 'liquidacao → tempo-real'],
];

// Aresta permitida (ou não), mas apontando para dentro do módulo e não para o index.ts.
const FORA_DO_INDEX: [string, string, string][] = [
  ['lances', '../carteira/servico-de-carteira.js', 'arquivo interno com extensão'],
  ['lances', '../carteira/servico-de-carteira', 'arquivo interno sem extensão'],
  ['lances', '../carteira/repositorio.js', 'repositório de outro módulo'],
  ['lotes', '../catalogo/catalogo.module.js', 'aresta permitida, mas fora do index.ts'],
];

describe('fronteiras entre módulos da API (specs/001 §Módulos da API)', () => {
  beforeAll(() => {
    mkdirSync(join(MODULOS, NAO_CATALOGADO), { recursive: true });
    writeFileSync(join(MODULOS, NAO_CATALOGADO, 'index.ts'), 'export const a = 1;\n');
  });
  afterAll(() => {
    rmSync(join(MODULOS, NAO_CATALOGADO), { recursive: true, force: true });
  });

  it.each(PERMITIDOS)('permite %s importando %s (%s)', async (origem, alvo) => {
    expect(await violacoes(`${BASE}/${origem}/caso.ts`, imp(alvo))).toEqual([]);
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
