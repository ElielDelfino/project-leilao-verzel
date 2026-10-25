import { QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';

import type { SchemasApi } from '@leilao/contracts';

import { criarQueryClient } from '../../src/consultas/queryClient';
import { rotas } from '../../src/rotas';
import { handlerDeSessao, servidor } from './servidor';

export interface AppRenderizado extends RenderResult {
  router: ReturnType<typeof createMemoryRouter>;
}

export interface OpcoesDoRender {
  /** Usuário logado; sem a opção (ou `null`) a sessão é anônima. */
  sessao?: SchemasApi['Usuario'] | null;
}

/** Renderiza a árvore de produção (providers + rotas reais) numa URL inicial. */
export function renderizarApp(url = '/', { sessao = null }: OpcoesDoRender = {}): AppRenderizado {
  servidor.use(handlerDeSessao(sessao));
  const router = createMemoryRouter(rotas, { initialEntries: [url] });
  const resultado = render(
    <QueryClientProvider client={criarQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...resultado, router };
}
