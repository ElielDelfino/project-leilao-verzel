import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Portas de dev do monorepo (.env: WEB_PORT, API_PORT). strictPort: a API libera CORS só para
// WEB_ORIGIN (http://localhost:15173), então a SPA não pode cair silenciosamente em outra porta.
const PORTA_WEB = 15173;
const ALVO_API = 'http://localhost:13000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: PORTA_WEB,
    strictPort: true,
    // Em produção o Caddy faz o mesmo proxy (specs/001, specs/014).
    proxy: {
      '/api': { target: ALVO_API, changeOrigin: true },
      '/socket.io': { target: ALVO_API, changeOrigin: true, ws: true },
    },
  },
  preview: {
    port: PORTA_WEB,
    strictPort: true,
  },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['./test/setup.ts'],
    // Por padrão o Vitest troca CSS por string vazia; os tokens são lidos no teste de contraste.
    css: { include: [/src\/estilos\/tokens\.css/] },
    restoreMocks: true,
    unstubGlobals: true,
  },
});
