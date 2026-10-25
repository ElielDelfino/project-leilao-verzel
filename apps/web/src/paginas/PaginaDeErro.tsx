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
      <div role="alert">
        <h1 className="text-3xl font-bold tracking-tight">{TITULO}</h1>
        <p className="mt-4 text-texto-suave">
          Não foi possível mostrar esta página. Tente recarregar ou volte à vitrine.
        </p>
      </div>
      <p className="mt-4">
        <Link to="/">Voltar à vitrine</Link>
      </p>
    </>
  );
}
