import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';

import { tituloDaPagina } from '../layout/site';
import type { AvisoDoPainel } from '../painel/CancelarLote';
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

  const [aviso, setAviso] = useState<AvisoDoPainel | null>(null);
  const refAviso = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (aviso?.tipo === 'sucesso') refAviso.current?.focus();
  }, [aviso]);

  function irParaPagina(destino: number, substituir = false) {
    setParams(destino > 1 ? { pagina: String(destino) } : {}, { replace: substituir });
  }

  return (
    <>
      <title>{tituloDaPagina(TITULO)}</title>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="titulo-pagina">{TITULO}</h1>
        <Link to="/painel/lotes/novo" className="botao-primario">
          Novo lote
        </Link>
      </div>
      {avisoDeLoteCriado ? (
        <p role="status" className="aviso mt-4">
          Lote criado.
        </p>
      ) : null}
      {aviso ? (
        <p
          ref={refAviso}
          tabIndex={-1}
          role={aviso.tipo === 'sucesso' ? 'status' : 'alert'}
          className="aviso mt-4"
        >
          {aviso.texto}
        </p>
      ) : null}
      <ResumoDoPainel />
      <section className="mt-8">
        <ListaMeusLotes
          pagina={pagina}
          aoIrParaPagina={irParaPagina}
          aoConcluirCancelamento={setAviso}
        />
      </section>
    </>
  );
}
