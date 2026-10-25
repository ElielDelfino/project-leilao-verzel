import '@testing-library/jest-dom/vitest';

import { cleanup, configure } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

// Todo render (inclusive renderHook) roda dentro de <StrictMode>, como em src/main.tsx: efeitos
// montam, desmontam e montam de novo, e updaters de estado rodam duas vezes.
configure({ reactStrictMode: true });

beforeEach(() => {
  // O jsdom cria um <html> vazio; em produção o lang vem do index.html (test/index-html.test.ts).
  document.documentElement.lang = 'pt-BR';
  // O jsdom não implementa canvas e avisa "Not implemented" a cada chamada do axe-core; sem
  // contexto 2D o axe só pula as checagens que dependem dele (contraste fica no e2e).
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
});

// Sem `globals: true`, o Testing Library não registra o cleanup sozinho.
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  delete document.documentElement.dataset['theme'];
});
