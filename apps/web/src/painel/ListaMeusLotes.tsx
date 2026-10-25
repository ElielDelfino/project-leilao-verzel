import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

import { listarMeusLotes } from '../api/painel';
import { ErroDoServidor } from '../formularios/ErroDoServidor';
import { TAMANHO_DA_PAGINA } from '../lotes/estadoDaVitrine';
import { Paginacao } from '../lotes/Paginacao';
import { TabelaMeusLotes } from './TabelaMeusLotes';

interface Props {
  pagina: number;
  aoIrParaPagina: (pagina: number, substituir?: boolean) => void;
}

/** Lista paginada "Meus lotes" (specs/012 §Painel do leiloeiro). */
export function ListaMeusLotes({ pagina, aoIrParaPagina }: Props) {
  const consulta = useQuery({
    queryKey: ['painel', 'lotes', pagina],
    queryFn: () => listarMeusLotes(pagina),
    retry: false,
  });

  const total = consulta.data?.meta.total ?? 0;
  const totalPaginas = Math.ceil(total / TAMANHO_DA_PAGINA);
  const alemDaUltima = total > 0 && pagina > totalPaginas;
  useEffect(() => {
    if (alemDaUltima) aoIrParaPagina(totalPaginas, true);
    // Reagir à detecção basta; o callback é recriado a cada render.
  }, [alemDaUltima, totalPaginas]);

  if (consulta.error) {
    return (
      <div className="flex flex-col items-start gap-4">
        <ErroDoServidor erro={consulta.error} />
        <button
          type="button"
          onClick={() => void consulta.refetch()}
          className="min-h-11 rounded-md border border-borda-controle px-4 font-medium"
        >
          Tentar de novo
        </button>
      </div>
    );
  }
  if (!consulta.data) return <p role="status">Carregando seus lotes…</p>;
  if (total === 0) return <p>Você ainda não criou lotes.</p>;
  return (
    <>
      <TabelaMeusLotes lotes={consulta.data.lotes} />
      <Paginacao pagina={pagina} totalPaginas={totalPaginas} aoIr={(p) => aoIrParaPagina(p)} />
    </>
  );
}
