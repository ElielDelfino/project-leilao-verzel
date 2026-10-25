import { Link } from 'react-router';

import type { Lote } from '../api/lotes';
import { ROTULOS_DE_RARIDADE, textoDeHorario, textoDeLances, textoDePreco } from './rotulos';

/** Item da lista da vitrine (specs/012 §Vitrine). */
export function CartaoDoLote({ lote }: { lote: Lote }) {
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-borda bg-superficie p-4">
      <img
        src={lote.imagemUrl}
        alt={`Carta ${lote.cartaNome}`}
        width={488}
        height={680}
        loading="lazy"
        className="aspect-[488/680] w-full object-contain"
      />
      <h2 className="text-lg font-bold">
        <Link to={`/lotes/${lote.id}`}>{lote.titulo}</Link>
      </h2>
      <p>{ROTULOS_DE_RARIDADE[lote.raridade]}</p>
      <p className="font-medium">{textoDePreco(lote)}</p>
      <p>{textoDeLances(lote.totalLances)}</p>
      <p className="text-texto-suave">{textoDeHorario(lote)}</p>
    </li>
  );
}
