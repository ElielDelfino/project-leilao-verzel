import { Link } from 'react-router';

import { tituloDaPagina } from '../layout/site';

const TITULO = 'Página não encontrada';

// Rota `*` de specs/012 §Rotas: dentro do layout, sem redirecionamento automático.
export function PaginaNaoEncontrada() {
  return (
    <>
      <title>{tituloDaPagina(TITULO)}</title>
      <h1 className="text-3xl font-bold tracking-tight">{TITULO}</h1>
      <p className="mt-4">
        <Link to="/">Voltar à vitrine</Link>
      </p>
    </>
  );
}
