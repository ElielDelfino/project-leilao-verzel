// Hook de resolução para rodar os scripts de banco (migrate.ts, seed.ts) direto no Node 24, com
// type stripping e sem build: o código da API importa `./x.js` (exigência do TypeScript com
// module nodenext), mas no fonte o arquivo é `./x.ts`. Este hook troca o `.js` pelo `.ts`
// quando quem importa é um `.ts` e o `.ts` existe. Uso: node --import ./apps/api/src/db/resolver-ts.mjs
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath, URL } from 'node:url';

const RELATIVO_JS = /^\.\.?\/.*\.js$/;

registerHooks({
  resolve(especificador, contexto, proximo) {
    const pai = contexto.parentURL;
    if (pai?.startsWith('file:') && pai.endsWith('.ts') && RELATIVO_JS.test(especificador)) {
      const candidato = new URL(`${especificador.slice(0, -'.js'.length)}.ts`, pai);
      if (existsSync(fileURLToPath(candidato))) {
        return proximo(candidato.href, contexto);
      }
    }
    return proximo(especificador, contexto);
  },
});
