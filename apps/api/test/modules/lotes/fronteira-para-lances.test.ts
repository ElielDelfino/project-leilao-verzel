// Fronteira (tarefa 075): o módulo lances usa a interface de lotes só pelo index.ts. O lint real
// (eslint.config.mjs) aceita o import pelo index e barra o import direto do schema.ts.
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const RAIZ = resolve(fileURLToPath(new URL('../../../../..', import.meta.url)));
const ARQUIVO_EM_LANCES = join(RAIZ, 'apps/api/src/modules/lances/servico-ficticio-075.ts');
const REGRA = 'boundaries/dependencies';

const eslint = new ESLint({ cwd: RAIZ });

async function violacoes(codigo: string): Promise<string[]> {
  const [resultado] = await eslint.lintText(codigo, { filePath: ARQUIVO_EM_LANCES });
  return (resultado?.messages ?? []).filter((m) => m.ruleId === REGRA).map((m) => m.message);
}

describe('lotes: fronteira usada por lances', () => {
  it('aceita travar, registrar, resumir e ler o relógio pelo index.ts', async () => {
    const codigo = `import { agora, obterResumos, registrarLance, travarLote } from '../lotes/index.js';
export const usa = [agora, obterResumos, registrarLance, travarLote];
`;
    await expect(violacoes(codigo)).resolves.toEqual([]);
  });

  it('barra o import direto do schema.ts de lotes', async () => {
    const codigo = `import { lots } from '../lotes/schema.js';
export const usa = lots;
`;
    await expect(violacoes(codigo)).resolves.not.toEqual([]);
  });
});
