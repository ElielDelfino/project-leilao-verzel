import './estilos/index.css';

import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';

import { criarQueryClient } from './consultas/queryClient';
import { rotas } from './rotas';
import { ProvedorDeTempoReal } from './tempo-real/ProvedorDeTempoReal';

const elementoRaiz = document.getElementById('root');
if (!elementoRaiz) {
  throw new Error('index.html sem o elemento #root');
}

// Roteador e cache criados uma vez, fora da árvore React (recomendação do React Router).
const router = createBrowserRouter(rotas);
const queryClient = criarQueryClient();

createRoot(elementoRaiz).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ProvedorDeTempoReal>
        <RouterProvider router={router} />
      </ProvedorDeTempoReal>
    </QueryClientProvider>
  </StrictMode>,
);
