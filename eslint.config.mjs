// ESLint flat config do monorepo (ADR 0001): typescript-eslint strict + fronteiras dos módulos da API.
import { resolve } from 'node:path';

import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import boundaries from 'eslint-plugin-boundaries';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const ROOT = resolve(import.meta.dirname);

// Módulos da API (specs/001 §Módulos da API, ADR 0003). Cada um em apps/api/src/modules/<nome>/,
// com a interface pública em index.ts.
const MODULOS_API = [
  'identidade',
  'carteira',
  'catalogo',
  'lotes',
  'lances',
  'tempo-real',
  'liquidacao',
];

// Ordem de dependência permitida (specs/001). Módulos fora desta tabela não importam nenhum outro;
// tempo-real só consome eventos de domínio. Ciclos são proibidos.
const DEPENDENCIAS_PERMITIDAS = {
  lances: ['lotes', 'carteira', 'catalogo', 'identidade'],
  liquidacao: ['lances', 'lotes', 'carteira'],
};

const INTERFACE_PUBLICA = 'index.ts';

const politicasDosModulos = Object.entries(DEPENDENCIAS_PERMITIDAS).map(([origem, destinos]) => ({
  from: { element: { type: 'modulo-api', captured: { nome: origem } } },
  allow: {
    to: {
      element: {
        type: 'modulo-api',
        captured: { nome: destinos.join('|') },
        fileInternalPath: INTERFACE_PUBLICA,
      },
    },
  },
}));

export default defineConfig([
  globalIgnores([
    '**/dist/',
    '**/build/',
    '**/coverage/',
    '**/.vite/',
    'tasks/',
    'tmp/',
    'learning/',
    '.restauracao/',
    '.claude/',
    'playwright-report/',
    'test-results/',
    'blob-report/',
  ]),
  {
    files: ['**/*.{js,mjs,cjs,ts,mts,cts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.strict],
  },
  {
    files: ['*.{js,mjs,cjs}', 'scripts/**/*.{js,mjs,cjs}'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['apps/api/**/*.{ts,mts,cts}'],
    plugins: { boundaries },
    settings: {
      'boundaries/root-path': ROOT,
      'boundaries/elements': [
        { type: 'modulo-api', pattern: 'apps/api/src/modules/*', capture: ['nome'] },
      ],
      'import/resolver': {
        typescript: { alwaysTryTypes: true },
      },
    },
    rules: {
      // Entre módulos: só o que está em DEPENDENCIAS_PERMITIDAS e só pela interface pública.
      // Imports dentro do mesmo módulo, de código fora dos módulos e de pacotes externos não são afetados.
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          policies: politicasDosModulos,
        },
      ],
    },
  },
]);

export { MODULOS_API };
