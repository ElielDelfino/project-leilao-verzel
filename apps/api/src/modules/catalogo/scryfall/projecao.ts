// Leitura das respostas da Scryfall (dado externo: validado antes de usar) e projeção da carta da
// busca (specs/005 §Busca; CartaDaBusca em apps/api/openapi.yaml).
import { z } from 'zod';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const RARIDADES = ['common', 'uncommon', 'rare', 'mythic', 'special', 'bonus'] as const;
export type Raridade = (typeof RARIDADES)[number];

/** Carta do resultado da busca, como a API a devolve (CartaDaBusca). */
export interface CartaDaBusca {
  readonly scryfallId: string;
  readonly nome: string;
  readonly colecao: string;
  readonly raridade: Raridade;
  readonly tipo: string;
  readonly artista: string | null;
  readonly imagemUrl: string | null;
}

/** Página inteira da Scryfall (até 175 cartas) já projetada, e o `total_cards` dela. */
export interface PaginaDaBusca {
  readonly total: number;
  readonly cartas: readonly CartaDaBusca[];
}

/** JSON de `GET /cards/{id}` como a Scryfall o devolve (o snapshot guarda o objeto inteiro). */
export type CartaScryfall = Readonly<Record<string, unknown>>;

const urlHttp = z.string().regex(/^https?:\/\/\S+$/);
const imagens = z.object({ small: urlHttp.optional() }).optional();

const cartaDaScryfall = z.object({
  id: z.string().regex(UUID),
  name: z.string(),
  set_name: z.string(),
  rarity: z.enum(RARIDADES),
  type_line: z.string(),
  artist: z.string().optional(),
  image_uris: imagens,
  card_faces: z.array(z.object({ image_uris: imagens })).optional(),
});

const listaDaScryfall = z.object({
  total_cards: z.number().int().min(0),
  data: z.array(cartaDaScryfall),
});

const cartaCompleta = z.looseObject({ id: z.string().regex(UUID) });

const paginaGuardada = z.object({
  total: z.number().int().min(0),
  cartas: z.array(
    z.object({
      scryfallId: z.string(),
      nome: z.string(),
      colecao: z.string(),
      raridade: z.enum(RARIDADES),
      tipo: z.string(),
      artista: z.string().nullable(),
      imagemUrl: z.string().nullable(),
    }),
  ),
});

function projetar(carta: z.infer<typeof cartaDaScryfall>): CartaDaBusca {
  const imagem = carta.image_uris?.small ?? carta.card_faces?.[0]?.image_uris?.small ?? null;
  return {
    scryfallId: carta.id,
    nome: carta.name,
    colecao: carta.set_name,
    raridade: carta.rarity,
    tipo: carta.type_line,
    artista: carta.artist ?? null,
    imagemUrl: imagem,
  };
}

/** Lista de `/cards/search` projetada; `undefined` se o corpo não tem a forma esperada. */
export function lerListaDaBusca(corpo: unknown): PaginaDaBusca | undefined {
  const lido = listaDaScryfall.safeParse(corpo);
  if (!lido.success) return undefined;
  return { total: lido.data.total_cards, cartas: lido.data.data.map(projetar) };
}

/** Objeto de `/cards/{id}`; `undefined` se não for um objeto com `id` UUID. */
export function lerCarta(corpo: unknown): CartaScryfall | undefined {
  const lido = cartaCompleta.safeParse(corpo);
  return lido.success ? lido.data : undefined;
}

/** Valor do cache da busca; `undefined` (tratado como miss) se estiver corrompido. */
export function lerPaginaGuardada(texto: string): PaginaDaBusca | undefined {
  const lido = paginaGuardada.safeParse(jsonOuUndefined(texto));
  return lido.success ? lido.data : undefined;
}

export function jsonOuUndefined(texto: string): unknown {
  try {
    return JSON.parse(texto) as unknown;
  } catch {
    // Corpo que não é JSON: quem chama trata `undefined` como resposta inválida.
    return undefined;
  }
}
