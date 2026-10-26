import { Link } from 'react-router';

import type { Lote } from '../api/lotes';
import { formatarDataHora } from '../formatacao/data';
import { formatarCentavos } from '../formatacao/dinheiro';
import { CancelarLote, type AvisoDoPainel } from './CancelarLote';
import { ICONES_DE_STATUS, ROTULOS_DE_STATUS } from '../lotes/rotulos';

/** "Resultado" de specs/012 §Painel: só lote encerrado tem resultado. */
export function textoDoResultado(lote: Pick<Lote, 'status' | 'valorArremateCentavos'>): string {
  if (lote.status !== 'encerrado') return '—';
  return lote.valorArremateCentavos === null
    ? 'Sem arremate'
    : `Arrematado por ${formatarCentavos(lote.valorArremateCentavos)}`;
}

interface Props {
  lotes: Lote[];
  aoConcluirCancelamento: (aviso: AvisoDoPainel) => void;
}

export function TabelaMeusLotes({ lotes, aoConcluirCancelamento }: Props) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <caption className="mb-2 text-left text-xl font-bold">Meus lotes</caption>
        <thead>
          <tr>
            <th scope="col">Lote</th>
            <th scope="col">Status</th>
            <th scope="col">Início</th>
            <th scope="col">Fim</th>
            <th scope="col">Lances</th>
            <th scope="col">Resultado</th>
            <th scope="col">Ações</th>
          </tr>
        </thead>
        <tbody>
          {lotes.map((lote) => (
            <tr key={lote.id} className="border-t border-borda">
              <td className="py-2 pr-4">
                <Link to={`/lotes/${lote.id}`}>{lote.titulo}</Link>
              </td>
              <td className="pr-4">
                <span aria-hidden="true">{ICONES_DE_STATUS[lote.status]} </span>
                {ROTULOS_DE_STATUS[lote.status]}
              </td>
              <td className="pr-4">{formatarDataHora(lote.inicioEm)}</td>
              <td className="pr-4">{formatarDataHora(lote.fimEm)}</td>
              <td className="pr-4">{lote.totalLances}</td>
              <td className="pr-4">{textoDoResultado(lote)}</td>
              <td className="py-1">
                {lote.status === 'agendado' || lote.status === 'ao_vivo' ? (
                  <CancelarLote lote={lote} aoConcluir={aoConcluirCancelamento} />
                ) : (
                  <Link
                    to={`/auditoria/${lote.id}`}
                    aria-label={`Auditoria do lote ${lote.titulo}`}
                  >
                    Auditoria
                  </Link>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
