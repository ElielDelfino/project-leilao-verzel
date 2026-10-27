import type { LoteDetalhe } from '../api/lotes';
import { ROTULOS_DE_RARIDADE } from '../lotes/rotulos';

export function Carta({ lote }: { lote: LoteDetalhe }) {
  const { carta } = lote;
  return (
    <section aria-labelledby="carta-titulo" className="cartao self-start overflow-hidden">
      <h2 id="carta-titulo" className="sr-only">
        Carta
      </h2>
      <div className="bg-poco p-6">
        <img
          src={lote.imagemUrl}
          alt={`Carta ${carta.nome}`}
          width={488}
          height={680}
          className="mx-auto aspect-[488/680] w-full max-w-sm object-contain"
        />
        {carta.artista ? (
          <p className="mt-3 text-center text-xs text-texto-suave">Ilustração: {carta.artista}</p>
        ) : null}
      </div>
      <div className="border-t border-borda p-5">
        <ul className="flex flex-col divide-y divide-borda text-sm">
          <li className="py-2 font-semibold first:pt-0">Carta: {carta.nome}</li>
          <li className="py-2">Coleção: {carta.colecao}</li>
          <li className="py-2">Raridade: {ROTULOS_DE_RARIDADE[carta.raridade]}</li>
          <li className="py-2 last:pb-0">Tipo: {carta.tipo}</li>
        </ul>
        {carta.textoOracle ? (
          <p className="mt-4 rounded-xl bg-poco p-4 text-sm leading-relaxed whitespace-pre-line">
            {carta.textoOracle}
          </p>
        ) : null}
      </div>
    </section>
  );
}
