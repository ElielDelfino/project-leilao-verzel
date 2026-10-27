import type { Auditoria } from '../api/auditoria';
import { formatarDataHora } from '../formatacao/data';
import { formatarCentavos } from '../formatacao/dinheiro';
import { ROTULOS_DE_STATUS } from '../lotes/rotulos';

function Item({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-texto-suave">{rotulo}</dt>
      <dd className="font-semibold break-all">{children}</dd>
    </div>
  );
}

export function SeloDoLote({ selo }: { selo: Auditoria['selo'] }) {
  return (
    <section aria-labelledby="titulo-selo" className="cartao mt-6 p-5">
      <h2 id="titulo-selo" className="text-lg font-bold">
        Selo do lote
      </h2>
      {selo === null ? (
        <p className="mt-2 text-texto-suave">
          Este lote ainda não foi selado. O selo é gerado no encerramento ou no cancelamento.
        </p>
      ) : (
        <dl className="mt-4 grid gap-3">
          <Item rotulo="Situação">{ROTULOS_DE_STATUS[selo.status]}</Item>
          <Item rotulo="Total de lances">{selo.totalLances}</Item>
          <Item rotulo="Hash final">{selo.hashFinal}</Item>
          <Item rotulo="Vencedor">{selo.vencedorPseudonimo ?? '—'}</Item>
          <Item rotulo="Valor do arremate">
            {selo.valorArremateCentavos === null
              ? '—'
              : formatarCentavos(selo.valorArremateCentavos)}
          </Item>
          <Item rotulo="Selado em">{formatarDataHora(selo.seladoEm)}</Item>
          <Item rotulo="Chave de assinatura">{selo.keyId}</Item>
          <Item rotulo="Assinatura">{selo.assinatura}</Item>
        </dl>
      )}
    </section>
  );
}
