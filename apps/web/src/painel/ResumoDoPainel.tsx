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
            className="botao-secundario"
          >
            Tentar de novo
          </button>
        </div>
      ) : !consulta.data ? (
        <p role="status" className="mt-2">
          Carregando resumo…
        </p>
      ) : (
        <dl className="mt-3 grid gap-4 sm:grid-cols-3">
          <div className="cartao p-5">
            <dt className="text-xs font-semibold tracking-wider text-texto-suave uppercase">
              Total recebido
            </dt>
            <dd className="mt-2 text-3xl font-extrabold text-destaque tabular-nums">
              {formatarCentavos(consulta.data.totalRecebidoCentavos)}
            </dd>
          </div>
          <div className="cartao p-5">
            <dt className="text-xs font-semibold tracking-wider text-texto-suave uppercase">
              Lotes arrematados
            </dt>
            <dd className="mt-2 text-3xl font-extrabold tabular-nums">
              {consulta.data.lotesArrematados}
            </dd>
          </div>
          <div className="cartao p-5">
            <dt className="text-xs font-semibold tracking-wider text-texto-suave uppercase">
              Lotes sem lance
            </dt>
            <dd className="mt-2 text-3xl font-extrabold tabular-nums">
              {consulta.data.lotesSemLance}
            </dd>
          </div>
        </dl>
      )}
    </section>
  );
}
