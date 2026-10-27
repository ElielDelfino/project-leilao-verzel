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

const CLASSE_DO_STATUS: Record<Lote['status'], string> = {
  ao_vivo: 'bg-sucesso/10 text-sucesso',
  agendado: 'bg-aviso/10 text-aviso',
  encerrado: 'bg-perigo/10 text-perigo',
  cancelado: 'bg-texto-suave/10 text-texto-suave',
};

interface Props {
  lotes: Lote[];
  aoConcluirCancelamento: (aviso: AvisoDoPainel) => void;
}

export function TabelaMeusLotes({ lotes, aoConcluirCancelamento }: Props) {
  return (
    <div className="cartao overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="p-4 text-left text-lg font-bold">Meus lotes</caption>
          <thead className="bg-poco text-xs tracking-wider text-texto-suave uppercase">
            <tr>
              <th scope="col" className="px-4 py-3 font-semibold">
                Lote
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                Status
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                Início
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                Fim
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                Lances
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                Resultado
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                Ações
              </th>
            </tr>
          </thead>
          <tbody>
            {lotes.map((lote) => (
              <tr key={lote.id} className="border-t border-borda">
                <td className="px-4 py-3 font-semibold">
                  <Link to={`/lotes/${lote.id}`}>{lote.titulo}</Link>
                </td>
                <td className="px-4 py-3">
                  <span className={`selo ${CLASSE_DO_STATUS[lote.status]}`}>
                    <span aria-hidden="true">{ICONES_DE_STATUS[lote.status]} </span>
                    {ROTULOS_DE_STATUS[lote.status]}
                  </span>
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-texto-suave">
                  {formatarDataHora(lote.inicioEm)}
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-texto-suave">
                  {formatarDataHora(lote.fimEm)}
                </td>
                <td className="px-4 py-3 tabular-nums">{lote.totalLances}</td>
                <td className="px-4 py-3 font-semibold text-destaque tabular-nums">
                  {textoDoResultado(lote)}
                </td>
                <td className="px-4 py-2">
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
    </div>
  );
}
