import type { RouteObject } from 'react-router';

import { LayoutBase } from './layout/LayoutBase';
import { LayoutDeErro } from './layout/LayoutDeErro';
import { PaginaDeErro } from './paginas/PaginaDeErro';
import { PaginaNaoEncontrada } from './paginas/PaginaNaoEncontrada';
import { PaginaCadastro } from './paginas/PaginaCadastro';
import { PaginaCarteira } from './paginas/PaginaCarteira';
import { PaginaEntrar } from './paginas/PaginaEntrar';
import { PaginaProvisoria } from './paginas/PaginaProvisoria';
import { RotaAnonima, RotaRestrita } from './sessao/Guardas';
import { RaizDaSessao } from './sessao/RaizDaSessao';

// Rotas de specs/012 §Rotas. Por enquanto são páginas provisórias; o controle de acesso
// (anônimo, licitante, leiloeiro) entra com as telas de cada spec.
const provisoria = (titulo: string) => <PaginaProvisoria titulo={titulo} />;

export const rotas: RouteObject[] = [
  {
    element: <RaizDaSessao />,
    children: [
      {
        element: <LayoutBase />,
        // Só quando o próprio layout falha.
        errorElement: <LayoutDeErro />,
        children: [
          {
            // Rota sem caminho: um erro em qualquer página aparece no <Outlet>, dentro do layout.
            errorElement: <PaginaDeErro />,
            children: [
              { index: true, element: provisoria('Vitrine') },
              { path: 'lotes/:id', element: provisoria('Sala do lote') },
              {
                element: <RotaAnonima />,
                children: [
                  { path: 'entrar', element: <PaginaEntrar /> },
                  { path: 'cadastro', element: <PaginaCadastro /> },
                ],
              },
              {
                element: <RotaRestrita />,
                children: [
                  { path: 'carteira', element: <PaginaCarteira /> },
                  { path: 'meus-arremates', element: provisoria('Meus arremates') },
                  { path: 'painel', element: provisoria('Painel do leiloeiro') },
                  { path: 'painel/lotes/novo', element: provisoria('Novo lote') },
                ],
              },
              { path: 'auditoria/:loteId', element: provisoria('Auditoria do lote') },
              { path: 'comprovantes/:codigo', element: provisoria('Comprovante') },
              { path: '*', element: <PaginaNaoEncontrada /> },
            ],
          },
        ],
      },
    ],
  },
];
