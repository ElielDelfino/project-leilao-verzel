// Config do Vitest usada pelo verify (scripts/verify.mjs, tarefa 011) para os testes da API:
// coleta test/ e src/ (os testes de banco ainda em src/db/*.test.ts vão para test/db/ na tarefa
// 025) e liga o setup global do banco de teste (LEILAO_TEST_DB, specs/013).
// Uso: vitest run --config test/setup/vitest.config.ts (a partir de apps/api).
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: fileURLToPath(new URL('../..', import.meta.url)),
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    globalSetup: ['./test/setup/global.ts'],
  },
});
