import { QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';

import { criarQueryClient } from '../../src/consultas/queryClient';
import { rotas } from '../../src/rotas';

export interface AppRenderizado extends RenderResult {
  router: ReturnType<typeof createMemoryRouter>;
}

/** Renderiza a árvore de produção (providers + rotas reais) numa URL inicial. */
export function renderizarApp(url = '/'): AppRenderizado {
  const router = createMemoryRouter(rotas, { initialEntries: [url] });
  const resultado = render(
    <QueryClientProvider client={criarQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...resultado, router };
}
