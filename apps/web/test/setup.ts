import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';

// O jsdom cria um <html> vazio; em produção o lang vem do index.html (test/index-html.test.ts).
beforeEach(() => {
  document.documentElement.lang = 'pt-BR';
});

// Sem `globals: true`, o Testing Library não registra o cleanup sozinho.
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  delete document.documentElement.dataset['theme'];
});
