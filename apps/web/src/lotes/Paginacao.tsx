interface PaginacaoProps {
  pagina: number;
  totalPaginas: number;
  aoIr: (pagina: number) => void;
}

const CLASSE_BOTAO =
  'min-h-11 min-w-11 rounded-md border border-borda-controle px-4 font-medium aria-disabled:opacity-60';

/** Paginação de specs/012 §Vitrine: só aparece com mais de uma página; nas pontas não navega. */
export function Paginacao({ pagina, totalPaginas, aoIr }: PaginacaoProps) {
  if (totalPaginas <= 1) return null;
  const naPrimeira = pagina <= 1;
  const naUltima = pagina >= totalPaginas;
  return (
    <nav aria-label="Paginação" className="mt-6 flex items-center gap-4">
      <button
        type="button"
        className={CLASSE_BOTAO}
        aria-disabled={naPrimeira}
        onClick={() => {
          if (!naPrimeira) aoIr(pagina - 1);
        }}
      >
        Anterior
      </button>
      <span>
        Página {pagina} de {totalPaginas}
      </span>
      <button
        type="button"
        className={CLASSE_BOTAO}
        aria-disabled={naUltima}
        onClick={() => {
          if (!naUltima) aoIr(pagina + 1);
        }}
      >
        Próxima
      </button>
    </nav>
  );
}
