// Catálogo sintético no formato público da Scryfall (task 052, specs/005). Três cartas fixas
// cobrem os formatos de imagem; o resto existe para exercitar a paginação de 175 por página.

export const POR_PAGINA = 175;
export const TOTAL_SINTETICAS = 397;

export const ID_CARTA_SIMPLES = '11111111-1111-4111-8111-111111111111';
export const ID_CARTA_DUPLA_FACE = '22222222-2222-4222-8222-222222222222';
export const ID_CARTA_SEM_IMAGEM = '33333333-3333-4333-8333-333333333333';

export interface CartaScryfall {
  object: 'card';
  id: string;
  name: string;
  set: string;
  set_name: string;
  rarity: string;
  type_line: string;
  artist: string;
  oracle_text: string;
  image_status: 'lowres' | 'missing';
  image_uris?: { normal: string };
  card_faces?: { name: string; image_uris: { normal: string } }[];
}

/** Formato do arquivo de imagem de cada carta (a dupla-face usa PNG; as demais, JPEG). */
export function extensaoDaImagem(id: string): 'jpg' | 'png' {
  return id === ID_CARTA_DUPLA_FACE ? 'png' : 'jpg';
}

function base(id: string, nome: string, tipo: string): Omit<CartaScryfall, 'image_status'> {
  return {
    object: 'card',
    id,
    name: nome,
    set: 'tst',
    set_name: 'Conjunto de Teste',
    rarity: 'common',
    type_line: tipo,
    artist: 'Artista de Teste',
    oracle_text: 'Texto de teste.',
  };
}

function idSintetico(n: number): string {
  return `44444444-4444-4444-8444-${String(n).padStart(12, '0')}`;
}

/** Todas as cartas do catálogo falso; `origem` é a URL base do servidor (para as imagens). */
export function montarCatalogo(origem: string): CartaScryfall[] {
  const imagem = (id: string) => `${origem}/imagens/${id}.${extensaoDaImagem(id)}`;
  const simples: CartaScryfall = {
    ...base(ID_CARTA_SIMPLES, 'Lightning Bolt', 'Instant'),
    image_status: 'lowres',
    image_uris: { normal: imagem(ID_CARTA_SIMPLES) },
  };
  const dupla: CartaScryfall = {
    ...base(ID_CARTA_DUPLA_FACE, 'Delver of Secrets // Insectile Aberration', 'Creature'),
    image_status: 'lowres',
    card_faces: [
      { name: 'Delver of Secrets', image_uris: { normal: imagem(ID_CARTA_DUPLA_FACE) } },
      { name: 'Insectile Aberration', image_uris: { normal: imagem(ID_CARTA_DUPLA_FACE) } },
    ],
  };
  const semImagem: CartaScryfall = {
    ...base(ID_CARTA_SEM_IMAGEM, 'Carta Sem Imagem', 'Sorcery'),
    image_status: 'missing',
  };
  const sinteticas = Array.from({ length: TOTAL_SINTETICAS }, (_, i): CartaScryfall => {
    const id = idSintetico(i + 1);
    return {
      ...base(id, `Carta Sintetica ${String(i + 1).padStart(3, '0')}`, 'Creature'),
      image_status: 'lowres',
      image_uris: { normal: imagem(id) },
    };
  });
  return [simples, dupla, semImagem, ...sinteticas];
}
