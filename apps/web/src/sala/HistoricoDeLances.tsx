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

export function HistoricoDeLances({ lances, seuPseudonimo, textoSemLances }: Props) {
  return (
    <section aria-labelledby="historico-titulo" className="flex flex-col gap-2">
      <h2 id="historico-titulo" className="text-xl font-bold">
        Últimos lances
      </h2>
      {lances.length === 0 ? (
        <p>{textoSemLances}</p>
      ) : (
        <ol className="flex flex-col gap-1">
          {lances.map((lance) => (
            <li key={lance.seq}>
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
