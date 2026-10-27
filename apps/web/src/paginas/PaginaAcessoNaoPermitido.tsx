import { Link } from 'react-router';

import { tituloDaPagina } from '../layout/site';
import { mensagemDoErro } from '../mensagens/erros';

const TITULO = 'Acesso não permitido';

// Papel errado numa rota restrita (D11): dentro do layout, sem redirecionar.
export function PaginaAcessoNaoPermitido() {
  return (
    <>
      <title>{tituloDaPagina(TITULO)}</title>
      <div className="cartao mx-auto mt-8 max-w-lg p-6 text-center sm:p-10">
        <h1 className="titulo-pagina">{TITULO}</h1>
        <p className="mt-4 text-texto-suave">{mensagemDoErro('PAPEL_NAO_PERMITIDO')}</p>
        <p className="mt-6">
          <Link to="/" className="botao-secundario">
            Voltar à vitrine
          </Link>
        </p>
      </div>
    </>
  );
}
