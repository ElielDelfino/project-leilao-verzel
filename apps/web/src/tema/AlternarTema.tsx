import { useTema } from './useTema';

// Botão de alternância (aria-pressed) com rótulo fixo: o estado vem do "pressionado", não do texto.
// Visualmente só o ícone, numa pílula redonda; o rótulo continua no nome acessível.
export function AlternarTema() {
  const { tema, alternar } = useTema();
  const escuro = tema === 'dark';

  return (
    <button
      type="button"
      aria-pressed={escuro}
      onClick={alternar}
      title="Tema escuro"
      className="grid size-11 place-items-center rounded-full border border-borda bg-poco text-texto transition-colors hover:border-borda-controle"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="size-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        {escuro ? (
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
        ) : (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </>
        )}
      </svg>
      <span className="sr-only">Tema escuro</span>
    </button>
  );
}
