import { Link } from 'react-router';

import { tituloDaPagina } from '../layout/site';

const TITULO = 'Página não encontrada';

// Rota `*` de specs/012 §Rotas: dentro do layout, sem redirecionamento automático.
export function PaginaNaoEncontrada() {
  return (
    <>
      <title>{tituloDaPagina(TITULO)}</title>
      <div className="cartao mx-auto mt-8 max-w-lg p-6 text-center sm:p-10">
        <h1 className="titulo-pagina">{TITULO}</h1>
        <p className="mt-6">
          <Link to="/" className="botao-secundario">
            Voltar à vitrine
          </Link>
        </p>
      </div>
    </>
  );
}
