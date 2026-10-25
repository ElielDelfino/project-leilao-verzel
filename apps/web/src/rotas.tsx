import type { RouteObject } from 'react-router';

import { LayoutBase } from './layout/LayoutBase';
import { LayoutDeErro } from './layout/LayoutDeErro';
import { PaginaDeErro } from './paginas/PaginaDeErro';
import { PaginaNaoEncontrada } from './paginas/PaginaNaoEncontrada';
import { PaginaAuditoria } from './paginas/PaginaAuditoria';
import { PaginaCadastro } from './paginas/PaginaCadastro';
import { PaginaCarteira } from './paginas/PaginaCarteira';
import { PaginaComprovante } from './paginas/PaginaComprovante';
import { PaginaEntrar } from './paginas/PaginaEntrar';
import { PaginaLote } from './paginas/PaginaLote';
import { PaginaMeusArremates } from './paginas/PaginaMeusArremates';
import { PaginaNovoLote } from './paginas/PaginaNovoLote';
import { PaginaPainel } from './paginas/PaginaPainel';
import { PaginaVitrine } from './paginas/PaginaVitrine';
import { RotaAnonima, RotaRestrita } from './sessao/Guardas';
import { RaizDaSessao } from './sessao/RaizDaSessao';

// Rotas de specs/012 §Rotas.
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
                  { path: 'meus-arremates', element: <PaginaMeusArremates /> },
                  { path: 'painel', element: <PaginaPainel /> },
                  { path: 'painel/lotes/novo', element: <PaginaNovoLote /> },
                ],
              },
              { path: 'auditoria/:loteId', element: <PaginaAuditoria /> },
              { path: 'comprovantes/:codigo', element: <PaginaComprovante /> },
              { path: '*', element: <PaginaNaoEncontrada /> },
            ],
          },
        ],
      },
    ],
  },
];
