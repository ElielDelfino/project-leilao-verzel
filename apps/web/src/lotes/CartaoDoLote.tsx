import { Link } from 'react-router';

import type { Lote, StatusLote } from '../api/lotes';
import {
  ICONES_DE_STATUS,
  ROTULOS_DE_RARIDADE,
  ROTULOS_DE_STATUS,
  textoDeHorario,
  textoDeLances,
  textoDePreco,
} from './rotulos';

/** Cor do selo e do contorno por status: cor nunca é o único sinal (o selo tem ícone e texto). */
const ESTILO_DO_STATUS: Record<StatusLote, { selo: string; borda: string }> = {
  ao_vivo: { selo: 'bg-sucesso text-fundo', borda: 'border-sucesso/40' },
  agendado: { selo: 'bg-aviso text-fundo', borda: 'border-aviso/30' },
  encerrado: { selo: 'bg-perigo text-fundo', borda: 'border-perigo/30' },
  cancelado: { selo: 'bg-texto-suave text-fundo', borda: 'border-borda' },
};

function Linha({ rotulo, children }: { rotulo: string; children: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-texto-suave">{rotulo}</span>
      <span className="font-semibold text-texto">{children}</span>
    </div>
  );
}

/** Item da lista da vitrine (specs/012 §Vitrine), no formato de card. */
export function CartaoDoLote({ lote }: { lote: Lote }) {
  const estilo = ESTILO_DO_STATUS[lote.status];
  return (
    <li
      className={`group relative flex flex-col overflow-hidden rounded-2xl border bg-superficie transition-transform hover:-translate-y-0.5 ${estilo.borda}`}
    >
      <div className="relative bg-poco p-4">
        <img
          src={lote.imagemUrl}
          alt={`Carta ${lote.cartaNome}`}
          width={488}
          height={680}
          loading="lazy"
          className="mx-auto aspect-[488/680] h-56 w-auto object-contain"
        />
        <span className={`selo absolute bottom-3 left-3 ${estilo.selo}`}>
          <span aria-hidden="true">{ICONES_DE_STATUS[lote.status]}</span>
          {ROTULOS_DE_STATUS[lote.status]}
        </span>
      </div>
      <div className="flex flex-1 flex-col border-t border-borda p-4">
        <h2 className="text-sm leading-snug font-bold">
          {/* O link cobre o card inteiro (::after), mas o nome acessível segue sendo o título. */}
          <Link
            to={`/lotes/${lote.id}`}
            className="text-texto no-underline after:absolute after:inset-0 after:content-[''] group-hover:text-link group-hover:underline"
          >
            {lote.titulo}
          </Link>
        </h2>
        <div className="mt-3 space-y-1.5">
          <Linha rotulo="Raridade">{ROTULOS_DE_RARIDADE[lote.raridade]}</Linha>
          <Linha rotulo="Lances">{textoDeLances(lote.totalLances)}</Linha>
        </div>
        <p className="mt-3 text-xs text-texto-suave">{textoDeHorario(lote)}</p>
        <p className="mt-auto pt-4">
          <span className="flex items-center gap-2 rounded-xl bg-destaque/10 px-4 py-3 text-sm font-bold text-destaque">
            {textoDePreco(lote)}
          </span>
        </p>
      </div>
    </li>
  );
}
