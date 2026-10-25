import type { CartaDaBusca } from '../api/catalogo';

export const TAMANHO_DO_CATALOGO = 25;
export const TAMANHO_MAXIMO_DE_PAGINAS = 500;

/** Miniatura da própria Scryfall (ADR 0029); sem imagem, o texto "Sem imagem". */
export function Miniatura({ carta }: { carta: Pick<CartaDaBusca, 'nome' | 'imagemUrl'> }) {
  if (carta.imagemUrl === null) {
    return (
      <span className="flex h-28 w-20 shrink-0 items-center justify-center text-center text-sm">
        Sem imagem
      </span>
    );
  }
  return (
    <img
      src={carta.imagemUrl}
      alt={`Carta ${carta.nome}`}
      referrerPolicy="no-referrer"
      width={80}
      height={112}
      className="h-28 w-20 shrink-0 rounded"
    />
  );
}
