interface PaginacaoProps {
  pagina: number;
  totalPaginas: number;
  aoIr: (pagina: number) => void;
}

/** Paginação de specs/012 §Vitrine: só aparece com mais de uma página; nas pontas não navega. */
export function Paginacao({ pagina, totalPaginas, aoIr }: PaginacaoProps) {
  if (totalPaginas <= 1) return null;
  const naPrimeira = pagina <= 1;
  const naUltima = pagina >= totalPaginas;
  return (
    <nav aria-label="Paginação" className="mt-8 flex items-center justify-center gap-4">
      <button
        type="button"
        className="botao-secundario min-w-11"
        aria-disabled={naPrimeira}
        onClick={() => {
          if (!naPrimeira) aoIr(pagina - 1);
        }}
      >
        Anterior
      </button>
      <span className="rounded-full border border-borda bg-poco px-4 py-2 text-sm font-semibold tabular-nums">
        Página {pagina} de {totalPaginas}
      </span>
      <button
        type="button"
        className="botao-secundario min-w-11"
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
