import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';

import { tituloDaPagina } from '../layout/site';
import { ListaMeusLotes } from '../painel/ListaMeusLotes';
import { ResumoDoPainel } from '../painel/ResumoDoPainel';

const TITULO = 'Painel do leiloeiro';
const PAGINA_MAXIMA = 500;

function lerPagina(valor: string | null): number {
  if (valor === null || !/^\d+$/.test(valor)) return 1;
  const numero = Number(valor);
  return numero >= 1 && numero <= PAGINA_MAXIMA ? numero : 1;
}

/**
 * O novo lote (task 060) deve navegar com `navigate('/painel', { state: { loteCriado: true } })`
 * para mostrar o aviso "Lote criado." aqui.
 */
export function PaginaPainel() {
  const [params, setParams] = useSearchParams();
  const local = useLocation();
  const navegar = useNavigate();
  const pagina = lerPagina(params.get('pagina'));

  // O aviso vale só nesta visita: guarda e limpa o estado do histórico, para sumir ao recarregar.
  const [avisoDeLoteCriado] = useState(
    () => (local.state as { loteCriado?: unknown } | null)?.loteCriado === true,
  );
  useEffect(() => {
    if (avisoDeLoteCriado) {
      void navegar(`${local.pathname}${local.search}`, { replace: true, state: null });
    }
    // Só na montagem.
  }, []);

  function irParaPagina(destino: number, substituir = false) {
    setParams(destino > 1 ? { pagina: String(destino) } : {}, { replace: substituir });
  }

  return (
    <>
      <title>{tituloDaPagina(TITULO)}</title>
      <h1 className="text-3xl font-bold tracking-tight">{TITULO}</h1>
      {avisoDeLoteCriado ? (
        <p role="status" className="mt-4 rounded-md border border-borda-controle p-3 font-medium">
          Lote criado.
        </p>
      ) : null}
      <p className="mt-4">
        <Link
          to="/painel/lotes/novo"
          className="inline-flex min-h-11 items-center rounded-md border border-primario bg-primario px-4 font-medium text-texto-sobre-primario"
        >
          Novo lote
        </Link>
      </p>
      <ResumoDoPainel />
      <section className="mt-8">
        <ListaMeusLotes pagina={pagina} aoIrParaPagina={irParaPagina} />
      </section>
    </>
  );
}
