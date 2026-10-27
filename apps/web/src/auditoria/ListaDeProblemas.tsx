import { type ProblemaExibido, textoDoProblema } from './problemas';

interface Props {
  titulo: string;
  problemas: readonly ProblemaExibido[];
}

/** Lista "lance #4: hash não confere" (specs/012 §Auditoria); não renderiza nada sem problemas. */
export function ListaDeProblemas({ titulo, problemas }: Props) {
  if (problemas.length === 0) return null;
  return (
    <section className="mt-6 rounded-2xl border border-perigo bg-perigo/10 p-5">
      <h2 className="text-lg font-bold text-perigo">{titulo}</h2>
      <ul className="mt-2 list-disc pl-6">
        {problemas.map((problema, i) => (
          <li key={`${problema.codigo}-${problema.seq ?? 'selo'}-${i}`}>
            {textoDoProblema(problema)}
          </li>
        ))}
      </ul>
    </section>
  );
}
