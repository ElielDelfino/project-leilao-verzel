// Catálogo sintético no formato público da Scryfall (task 052, specs/005). Quatro cartas fixas
// cobrem os formatos de imagem; o resto existe para exercitar a paginação de 175 por página.

export const POR_PAGINA = 175;
export const TOTAL_SINTETICAS = 397;

export const ID_CARTA_SIMPLES = '11111111-1111-4111-8111-111111111111';
export const ID_CARTA_DUPLA_FACE = '22222222-2222-4222-8222-222222222222';
export const ID_CARTA_SEM_IMAGEM = '33333333-3333-4333-8333-333333333333';

/** Carta com as imagens num host fora da allowlist (o snapshot recusa; a busca dá `null`). */
export const ID_CARTA_HOST_ESTRANHO = '55555555-5555-4555-8555-555555555555';

/** Host que não é `*.scryfall.io` (fronteira do ponto: o sufixo sem o ponto não vale). */
export const HOST_ESTRANHO = 'https://evilscryfall.io';

interface ImagensDaCarta {
  small: string;
  normal: string;
}

interface FaceDaCarta {
  name: string;
  mana_cost: string;
  type_line: string;
  oracle_text: string;
  artist: string;
  image_uris: ImagensDaCarta;
}

export interface CartaScryfall {
  object: 'card';
  id: string;
  name: string;
  set: string;
  set_name: string;
  rarity: string;
  type_line: string;
  artist: string;
  /** Ausente em multiface: como na Scryfall real, o texto fica em cada `card_faces[]`. */
  oracle_text?: string;
  mana_cost?: string;
  image_status: 'lowres' | 'missing';
  image_uris?: ImagensDaCarta;
  card_faces?: FaceDaCarta[];
}

/** Formato do arquivo de imagem de cada carta (a dupla-face usa PNG; as demais, JPEG). */
export function extensaoDaImagem(id: string): 'jpg' | 'png' {
  return id === ID_CARTA_DUPLA_FACE ? 'png' : 'jpg';
}

/** Miniatura `small` como a Scryfall real a publica (a API só repassa `cards.scryfall.io`). */
export function miniaturaDaScryfall(id: string): string {
  return `https://cards.scryfall.io/small/front/${id.slice(0, 1)}/${id.slice(1, 2)}/${id}.jpg`;
}

const ARTISTA = 'Artista de Teste';

function base(id: string, nome: string, tipo: string): Omit<CartaScryfall, 'image_status'> {
  return {
    object: 'card',
    id,
    name: nome,
    set: 'tst',
    set_name: 'Conjunto de Teste',
    rarity: 'common',
    type_line: tipo,
    artist: ARTISTA,
  };
}

function simples(id: string, nome: string, tipo: string, normal: string): CartaScryfall {
  return {
    ...base(id, nome, tipo),
    oracle_text: 'Texto de teste.',
    mana_cost: '{R}',
    image_status: 'lowres',
    image_uris: { small: miniaturaDaScryfall(id), normal },
  };
}

function face(nome: string, tipo: string, normal: string, small: string): FaceDaCarta {
  return {
    name: nome,
    mana_cost: '{U}',
    type_line: tipo,
    oracle_text: `Texto de ${nome}.`,
    artist: ARTISTA,
    image_uris: { small, normal },
  };
}

function idSintetico(n: number): string {
  return `44444444-4444-4444-8444-${String(n).padStart(12, '0')}`;
}

/** Todas as cartas do catálogo falso; `origem` é a URL base do servidor (para as imagens). */
export function montarCatalogo(origem: string): CartaScryfall[] {
  const imagem = (id: string): string => `${origem}/imagens/${id}.${extensaoDaImagem(id)}`;
  const normalDupla = imagem(ID_CARTA_DUPLA_FACE);
  const miniDupla = miniaturaDaScryfall(ID_CARTA_DUPLA_FACE);
  const dupla: CartaScryfall = {
    ...base(
      ID_CARTA_DUPLA_FACE,
      'Delver of Secrets // Insectile Aberration',
      'Creature — Human Wizard // Creature — Human Insect',
    ),
    image_status: 'lowres',
    card_faces: [
      face('Delver of Secrets', 'Creature — Human Wizard', normalDupla, miniDupla),
      face('Insectile Aberration', 'Creature — Human Insect', normalDupla, miniDupla),
    ],
  };
  const semImagem: CartaScryfall = {
    ...base(ID_CARTA_SEM_IMAGEM, 'Carta Sem Imagem', 'Sorcery'),
    oracle_text: 'Texto de teste.',
    image_status: 'missing',
  };
  const hostEstranho: CartaScryfall = {
    ...simples(ID_CARTA_HOST_ESTRANHO, 'Host Estranho', 'Artifact', ''),
    image_uris: {
      small: `${HOST_ESTRANHO}/small/${ID_CARTA_HOST_ESTRANHO}.jpg`,
      normal: `${HOST_ESTRANHO}/normal/${ID_CARTA_HOST_ESTRANHO}.jpg`,
    },
  };
  const sinteticas = Array.from({ length: TOTAL_SINTETICAS }, (_, i): CartaScryfall => {
    const id = idSintetico(i + 1);
    return simples(id, `Carta Sintetica ${String(i + 1).padStart(3, '0')}`, 'Creature', imagem(id));
  });
  return [
    simples(ID_CARTA_SIMPLES, 'Lightning Bolt', 'Instant', imagem(ID_CARTA_SIMPLES)),
    dupla,
    semImagem,
    hostEstranho,
    ...sinteticas,
  ];
}
