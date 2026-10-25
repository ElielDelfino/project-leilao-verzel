import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';

import { obterAuditoria } from '../api/auditoria';
import { ErroDaApi } from '../api/erro';
import { CabecalhoDoLote } from '../auditoria/CabecalhoDoLote';
import { ListaDeProblemas } from '../auditoria/ListaDeProblemas';
import { SeloDoLote } from '../auditoria/SeloDoLote';
import { TabelaDeLances } from '../auditoria/TabelaDeLances';
import { VereditoDoServidor } from '../auditoria/VereditoDoServidor';
import { VerificacaoNoNavegador } from '../auditoria/VerificacaoNoNavegador';
import { ErroDoServidor } from '../formularios/ErroDoServidor';
import { tituloDaPagina } from '../layout/site';
import { mensagemDoErro } from '../mensagens/erros';

const TITULO = 'Auditoria do lote';
const TITULO_NAO_ENCONTRADO = 'Lote não encontrado';

/** O `key` recria a página ao trocar de lote: nada de um lote aparece sob o veredito de outro. */
export function PaginaAuditoria() {
  const { loteId = '' } = useParams();
  return <AuditoriaDoLote key={loteId} loteId={loteId} />;
}

function AuditoriaDoLote({ loteId }: { loteId: string }) {
  // O veredito nunca vem de cache: sempre uma consulta nova (specs/012 §Auditoria).
  const consulta = useQuery({
    queryKey: ['auditoria', 'lote', loteId],
    queryFn: () => obterAuditoria(loteId),
    retry: false,
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  if (consulta.error instanceof ErroDaApi && consulta.error.status === 404) {
    return (
      <>
        <title>{tituloDaPagina(TITULO_NAO_ENCONTRADO)}</title>
        <h1 className="text-3xl font-bold tracking-tight">{TITULO_NAO_ENCONTRADO}</h1>
        <p className="mt-4">{mensagemDoErro('NAO_ENCONTRADO')}</p>
        <p className="mt-8">
          <Link to="/">Voltar à vitrine</Link>
        </p>
      </>
    );
  }

  const auditoria = consulta.data;
  return (
    <>
      <title>{tituloDaPagina(TITULO)}</title>
      <h1 className="text-3xl font-bold tracking-tight">{TITULO}</h1>
      {consulta.error && !auditoria ? (
        <div className="mt-4 flex flex-col items-start gap-4">
          <ErroDoServidor erro={consulta.error} />
          <button
            type="button"
            onClick={() => void consulta.refetch()}
            className="min-h-11 rounded-md border border-borda-controle px-4 font-medium"
          >
            Tentar de novo
          </button>
        </div>
      ) : !auditoria ? (
        <p role="status" className="mt-4">
          Carregando auditoria…
        </p>
      ) : (
        <>
          <CabecalhoDoLote lote={auditoria.lote} />
          <VereditoDoServidor auditoria={auditoria} />
          <ListaDeProblemas titulo="Problemas encontrados" problemas={auditoria.problemas} />
          <VerificacaoNoNavegador loteId={loteId} auditoria={auditoria} />
          <SeloDoLote selo={auditoria.selo} />
          <TabelaDeLances lances={auditoria.lances} />
        </>
      )}
    </>
  );
}
