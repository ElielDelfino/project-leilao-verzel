import { Link, type RouteObject } from 'react-router';

import { LayoutBase } from './layout/LayoutBase';
import { PaginaProvisoria } from './paginas/PaginaProvisoria';

// Rotas de specs/012 §Rotas. Por enquanto são páginas provisórias; o controle de acesso
// (anônimo, licitante, leiloeiro) entra com as telas de cada spec.
const provisoria = (titulo: string) => <PaginaProvisoria titulo={titulo} />;

export const rotas: RouteObject[] = [
  {
    element: <LayoutBase />,
    children: [
      { index: true, element: provisoria('Vitrine') },
      { path: 'lotes/:id', element: provisoria('Sala do lote') },
      { path: 'entrar', element: provisoria('Entrar') },
      { path: 'cadastro', element: provisoria('Cadastro') },
      { path: 'carteira', element: provisoria('Carteira') },
      { path: 'meus-arremates', element: provisoria('Meus arremates') },
      { path: 'painel', element: provisoria('Painel do leiloeiro') },
      { path: 'painel/lotes/novo', element: provisoria('Novo lote') },
      { path: 'auditoria/:loteId', element: provisoria('Auditoria do lote') },
      { path: 'comprovantes/:codigo', element: provisoria('Comprovante') },
      {
        path: '*',
        element: (
          <PaginaProvisoria titulo="Página não encontrada">
            <p className="mt-4">
              <Link to="/">Voltar à vitrine</Link>
            </p>
          </PaginaProvisoria>
        ),
      },
    ],
  },
];
