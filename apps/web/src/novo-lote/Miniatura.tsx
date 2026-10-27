import type { CartaDaBusca } from '../api/catalogo';

export const TAMANHO_DO_CATALOGO = 25;
export const TAMANHO_MAXIMO_DE_PAGINAS = 500;

/**
 * `grande` é o tamanho nativo da imagem `small` da Scryfall (146×204), para a grade da busca;
 * `pequena` é o resumo do passo de dados.
 */
const MEDIDAS = {
  pequena: { largura: 80, altura: 112, classe: 'h-28 w-20' },
  grande: { largura: 146, altura: 204, classe: 'h-51 w-36.5' },
} as const;

interface Props {
  carta: Pick<CartaDaBusca, 'nome' | 'imagemUrl'>;
  tamanho?: keyof typeof MEDIDAS;
}

/** Miniatura da própria Scryfall (ADR 0029); sem imagem, o texto "Sem imagem". */
export function Miniatura({ carta, tamanho = 'pequena' }: Props) {
  const medida = MEDIDAS[tamanho];
  if (carta.imagemUrl === null) {
    return (
      <span
        className={`flex ${medida.classe} shrink-0 items-center justify-center rounded-lg border border-borda bg-poco text-center text-sm text-texto-suave`}
      >
        Sem imagem
      </span>
    );
  }
  return (
    <img
      src={carta.imagemUrl}
      alt={`Carta ${carta.nome}`}
      referrerPolicy="no-referrer"
      width={medida.largura}
      height={medida.altura}
      className={`${medida.classe} shrink-0 rounded-lg`}
    />
  );
}
