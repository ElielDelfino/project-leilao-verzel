import type { RouteObject } from 'react-router';

import { LayoutBase } from './layout/LayoutBase';
import { LayoutDeErro } from './layout/LayoutDeErro';
import { PaginaDeErro } from './paginas/PaginaDeErro';
import { PaginaNaoEncontrada } from './paginas/PaginaNaoEncontrada';
import { PaginaCadastro } from './paginas/PaginaCadastro';
import { PaginaCarteira } from './paginas/PaginaCarteira';
import { PaginaEntrar } from './paginas/PaginaEntrar';
import { PaginaLote } from './paginas/PaginaLote';
import { PaginaNovoLote } from './paginas/PaginaNovoLote';
import { PaginaPainel } from './paginas/PaginaPainel';
import { PaginaProvisoria } from './paginas/PaginaProvisoria';
import { PaginaVitrine } from './paginas/PaginaVitrine';
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
              { index: true, element: <PaginaVitrine /> },
              // Na F3 a sala ao vivo substitui o detalhe (specs/012 §Rotas).
              { path: 'lotes/:id', element: <PaginaLote /> },
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
                  { path: 'painel', element: <PaginaPainel /> },
                  { path: 'painel/lotes/novo', element: <PaginaNovoLote /> },
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
