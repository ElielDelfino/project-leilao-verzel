import { Link } from 'react-router';

import type { Auditoria } from '../api/auditoria';
import { formatarDataHora } from '../formatacao/data';
import { ICONES_DE_STATUS, ROTULOS_DE_STATUS, textoDeLances } from '../lotes/rotulos';

function Item({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-texto-suave">{rotulo}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

/** Cabeçalho do lote (specs/012 §Auditoria): sem dado de usuário nem imagem de carta. */
export function CabecalhoDoLote({ lote }: { lote: Auditoria['lote'] }) {
  return (
    <section aria-labelledby="titulo-lote-auditado" className="mt-4">
      <h2 id="titulo-lote-auditado" className="sr-only">
        Dados do lote
      </h2>
      <dl className="grid gap-2 sm:grid-cols-2">
        <Item rotulo="Lote">{lote.titulo}</Item>
        <Item rotulo="Carta">{lote.cartaNome}</Item>
        <Item rotulo="Status">
          <span aria-hidden="true">{ICONES_DE_STATUS[lote.status]} </span>
          {ROTULOS_DE_STATUS[lote.status]}
        </Item>
        <Item rotulo="Início">{formatarDataHora(lote.inicioEm)}</Item>
        <Item rotulo="Fim">{formatarDataHora(lote.fimEm)}</Item>
        <Item rotulo="Lances registrados">{textoDeLances(lote.totalLances)}</Item>
      </dl>
      <p className="mt-2">
        <Link to={`/lotes/${encodeURIComponent(lote.id)}`}>Ver lote</Link>
      </p>
    </section>
  );
}
