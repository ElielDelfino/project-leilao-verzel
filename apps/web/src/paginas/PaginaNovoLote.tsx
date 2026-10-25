import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

import type { CartaDaBusca } from '../api/catalogo';
import { tituloDaPagina } from '../layout/site';
import { PassoBusca } from '../novo-lote/PassoBusca';
import { PassoDados } from '../novo-lote/PassoDados';

const TITULO = 'Novo lote';
const PAGINA_MAXIMA = 500;

function lerPagina(valor: string | null): number {
  if (valor === null || !/^\d+$/.test(valor)) return 1;
  const numero = Number(valor);
  return numero >= 1 && numero <= PAGINA_MAXIMA ? numero : 1;
}

/** Novo lote em dois passos na mesma rota (specs/012 §Novo lote). */
export function PaginaNovoLote() {
  const [params, setParams] = useSearchParams();
  const navegar = useNavigate();
  const queryClient = useQueryClient();
  const [carta, setCarta] = useState<CartaDaBusca | null>(null);
  const [aviso, setAviso] = useState<string | undefined>();
  const raiz = useRef<HTMLDivElement>(null);
  const q = (params.get('q') ?? '').trim();
  const pagina = lerPagina(params.get('pagina'));
  const passo = carta === null ? 1 : 2;

  // Ao trocar de passo o foco vai ao título do novo passo (não na primeira montagem).
  const primeiraVez = useRef(true);
  useEffect(() => {
    if (primeiraVez.current) {
      primeiraVez.current = false;
      return;
    }
    raiz.current?.querySelector<HTMLElement>('[data-foco-do-passo]')?.focus();
  }, [passo]);

  function buscar(texto: string) {
    setAviso(undefined);
    setParams({ q: texto });
  }

  function irParaPagina(destino: number) {
    setParams(destino > 1 ? { q, pagina: String(destino) } : { q });
  }

  return (
    <>
      <title>{tituloDaPagina(TITULO)}</title>
      <h1 className="text-3xl font-bold tracking-tight">{TITULO}</h1>
      <div ref={raiz}>
        {carta === null ? (
          <PassoBusca
            q={q}
            pagina={pagina}
            aviso={aviso}
            aoBuscar={buscar}
            aoIrParaPagina={irParaPagina}
            aoEscolher={(escolhida) => {
              setAviso(undefined);
              setCarta(escolhida);
            }}
          />
        ) : (
          <PassoDados
            carta={carta}
            aoTrocarCarta={() => setCarta(null)}
            aoRecusarCarta={(mensagem) => {
              setAviso(mensagem);
              setCarta(null);
            }}
            aoCriar={() => {
              void queryClient.invalidateQueries({ queryKey: ['painel'] });
              void navegar('/painel', { state: { loteCriado: true } });
            }}
          />
        )}
      </div>
    </>
  );
}
