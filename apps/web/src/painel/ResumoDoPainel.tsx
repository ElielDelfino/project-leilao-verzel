import { useQuery } from '@tanstack/react-query';

import { obterResumo } from '../api/painel';
import { ErroDoServidor } from '../formularios/ErroDoServidor';
import { formatarCentavos } from '../formatacao/dinheiro';

/** Resumo do painel (specs/012 §Painel do leiloeiro). */
export function ResumoDoPainel() {
  const consulta = useQuery({
    queryKey: ['painel', 'resumo'],
    queryFn: obterResumo,
    retry: false,
    refetchOnWindowFocus: 'always',
  });

  return (
    <section aria-labelledby="titulo-resumo" className="mt-6">
      <h2 id="titulo-resumo" className="text-xl font-bold">
        Resumo
      </h2>
      {consulta.error ? (
        <div className="mt-2 flex flex-col items-start gap-4">
          <ErroDoServidor erro={consulta.error} />
          <button
            type="button"
            onClick={() => void consulta.refetch()}
            className="min-h-11 rounded-md border border-borda-controle px-4 font-medium"
          >
            Tentar de novo
          </button>
        </div>
      ) : !consulta.data ? (
        <p role="status" className="mt-2">
          Carregando resumo…
        </p>
      ) : (
        <dl className="mt-2 grid gap-2 sm:grid-cols-3">
          <div>
            <dt className="text-texto-suave">Total recebido</dt>
            <dd className="text-lg font-bold">
              {formatarCentavos(consulta.data.totalRecebidoCentavos)}
            </dd>
          </div>
          <div>
            <dt className="text-texto-suave">Lotes arrematados</dt>
            <dd className="text-lg font-bold">{consulta.data.lotesArrematados}</dd>
          </div>
          <div>
            <dt className="text-texto-suave">Lotes sem lance</dt>
            <dd className="text-lg font-bold">{consulta.data.lotesSemLance}</dd>
          </div>
        </dl>
      )}
    </section>
  );
}
