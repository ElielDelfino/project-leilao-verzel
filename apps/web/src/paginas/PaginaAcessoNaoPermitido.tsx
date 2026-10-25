import { Link } from 'react-router';

import { tituloDaPagina } from '../layout/site';
import { mensagemDoErro } from '../mensagens/erros';

const TITULO = 'Acesso não permitido';

// Papel errado numa rota restrita (D11): dentro do layout, sem redirecionar.
export function PaginaAcessoNaoPermitido() {
  return (
    <>
      <title>{tituloDaPagina(TITULO)}</title>
      <h1 className="text-3xl font-bold tracking-tight">{TITULO}</h1>
      <p className="mt-4">{mensagemDoErro('PAPEL_NAO_PERMITIDO')}</p>
      <p className="mt-4">
        <Link to="/">Voltar à vitrine</Link>
      </p>
    </>
  );
}
