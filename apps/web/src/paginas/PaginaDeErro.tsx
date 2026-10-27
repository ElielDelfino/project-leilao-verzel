import { Link } from 'react-router';

import { tituloDaPagina } from '../layout/site';

const TITULO = 'Algo deu errado';

/**
 * errorElement das rotas: substitui a tela padrão do React Router (em inglês, com o stack).
 * Não mostra a mensagem do erro, que é interna; o React Router já a registra no console.
 */
export function PaginaDeErro() {
  return (
    <>
      <title>{tituloDaPagina(TITULO)}</title>
      <div className="cartao mx-auto mt-8 max-w-lg p-6 text-center sm:p-10">
        <div role="alert">
          <h1 className="titulo-pagina">{TITULO}</h1>
          <p className="mt-4 text-texto-suave">
            Não foi possível mostrar esta página. Tente recarregar ou volte à vitrine.
          </p>
        </div>
        <p className="mt-6">
          <Link to="/" className="botao-secundario">
            Voltar à vitrine
          </Link>
        </p>
      </div>
    </>
  );
}
