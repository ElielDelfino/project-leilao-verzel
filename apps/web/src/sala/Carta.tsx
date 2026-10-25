import type { LoteDetalhe } from '../api/lotes';
import { ROTULOS_DE_RARIDADE } from '../lotes/rotulos';

export function Carta({ lote }: { lote: LoteDetalhe }) {
  const { carta } = lote;
  return (
    <section aria-labelledby="carta-titulo">
      <h2 id="carta-titulo" className="sr-only">
        Carta
      </h2>
      <img
        src={lote.imagemUrl}
        alt={`Carta ${carta.nome}`}
        width={488}
        height={680}
        className="aspect-[488/680] w-full max-w-sm object-contain"
      />
      {carta.artista ? <p className="mt-2 text-texto-suave">Ilustração: {carta.artista}</p> : null}
      <ul className="mt-4 flex flex-col gap-1">
        <li>Carta: {carta.nome}</li>
        <li>Coleção: {carta.colecao}</li>
        <li>Raridade: {ROTULOS_DE_RARIDADE[carta.raridade]}</li>
        <li>Tipo: {carta.tipo}</li>
      </ul>
      {carta.textoOracle ? <p className="mt-2">{carta.textoOracle}</p> : null}
    </section>
  );
}
