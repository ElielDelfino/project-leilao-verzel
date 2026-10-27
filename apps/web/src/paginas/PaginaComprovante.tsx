import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';

import { obterComprovante } from '../api/comprovantes';
import { ErroDaApi } from '../api/erro';
import { DadosDoComprovante } from '../comprovante/DadosDoComprovante';
import { ErroDoServidor } from '../formularios/ErroDoServidor';
import { tituloDaPagina } from '../layout/site';

const TITULO = 'Comprovante de arremate';
const TITULO_NAO_ENCONTRADO = 'Comprovante não encontrado';

/** O `key` recria a página ao trocar de código: nada de um comprovante aparece sob outro. */
export function PaginaComprovante() {
  const { codigo = '' } = useParams();
  return <ComprovanteDoCodigo key={codigo} codigo={codigo} />;
}

function ComprovanteDoCodigo({ codigo }: { codigo: string }) {
  const consulta = useQuery({
    queryKey: ['comprovante', codigo],
    queryFn: () => obterComprovante(codigo),
    retry: false,
    refetchOnWindowFocus: false,
  });

  if (consulta.error instanceof ErroDaApi && consulta.error.status === 404) {
    return (
      <>
        <title>{tituloDaPagina(TITULO_NAO_ENCONTRADO)}</title>
        <h1 className="titulo-pagina">{TITULO_NAO_ENCONTRADO}</h1>
        <p className="aviso mt-4">
          Confira o link: o código do comprovante não existe ou está incorreto.
        </p>
        <p className="mt-8">
          <Link to="/">Voltar à vitrine</Link>
        </p>
      </>
    );
  }

  const comprovante = consulta.data;
  return (
    <>
      <title>{tituloDaPagina(TITULO)}</title>
      <h1 className="titulo-pagina">{TITULO}</h1>
      {consulta.error && !comprovante ? (
        <div className="mt-4 flex flex-col items-start gap-4">
          <ErroDoServidor erro={consulta.error} />
          <button
            type="button"
            onClick={() => void consulta.refetch()}
            className="botao-secundario"
          >
            Tentar de novo
          </button>
        </div>
      ) : !comprovante ? (
        <p role="status" className="mt-4">
          Carregando comprovante…
        </p>
      ) : (
        <DadosDoComprovante comprovante={comprovante} />
      )}
    </>
  );
}
