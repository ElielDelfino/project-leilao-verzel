import { formatarCentavos } from '../formatacao/dinheiro';
import type { LanceDoHistorico } from './estadoDaSala';

const formatoHora = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  timeStyle: 'medium',
});

interface Props {
  lances: readonly LanceDoHistorico[];
  seuPseudonimo: string | undefined;
  textoSemLances: string;
}

/** O lance mais recente (topo) em dourado; os seus com contorno primário. */
function classeDoLance(indice: number, seu: boolean): string {
  const base = 'rounded-xl border px-4 py-3 text-sm tabular-nums';
  if (indice === 0) return `${base} border-destaque/40 bg-destaque/10 font-bold text-destaque`;
  if (seu) return `${base} border-primario bg-poco font-semibold`;
  return `${base} border-borda bg-poco text-texto-suave`;
}

export function HistoricoDeLances({ lances, seuPseudonimo, textoSemLances }: Props) {
  return (
    <section aria-labelledby="historico-titulo" className="cartao flex flex-col gap-3 p-5 sm:p-6">
      <h2 id="historico-titulo" className="text-lg font-bold">
        Últimos lances
      </h2>
      {lances.length === 0 ? (
        <p className="aviso text-sm text-texto-suave">{textoSemLances}</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {lances.map((lance, indice) => (
            <li
              key={lance.seq}
              className={classeDoLance(indice, lance.pseudonimo === seuPseudonimo)}
            >
              {lance.pseudonimo}
              {lance.pseudonimo === seuPseudonimo ? ' (você)' : ''} ·{' '}
              {formatarCentavos(lance.valorCentavos)} ·{' '}
              {formatoHora.format(new Date(lance.criadoEm))}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
