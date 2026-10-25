import { QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';

import { criarQueryClient } from '../../src/consultas/queryClient';
import { rotas } from '../../src/rotas';
import { ProvedorDeTempoReal } from '../../src/tempo-real/ProvedorDeTempoReal';
import { handlerDeSessao, servidor } from './servidor';
import type { SocketFalso } from './socketFalso';

export interface AppComTempoReal extends RenderResult {
  router: ReturnType<typeof createMemoryRouter>;
}

/** Como `renderizarApp`, mas com o provedor de tempo real sobre o socket falso do teste. */
export function renderizarComTempoReal(url: string, socket: SocketFalso): AppComTempoReal {
  servidor.use(handlerDeSessao(null));
  const router = createMemoryRouter(rotas, { initialEntries: [url] });
  const criarSocket = () => socket;
  const resultado = render(
    <QueryClientProvider client={criarQueryClient()}>
      <ProvedorDeTempoReal criarSocket={criarSocket}>
        <RouterProvider router={router} />
      </ProvedorDeTempoReal>
    </QueryClientProvider>,
  );
  return { ...resultado, router };
}
