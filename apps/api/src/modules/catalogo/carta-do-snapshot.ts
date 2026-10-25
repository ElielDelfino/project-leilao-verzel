// Leitura da carta de `/cards/{id}` para o snapshot (specs/005 §Snapshot). Dado externo:
// validado antes de usar. Em multiface (dupla-face), a Scryfall põe `oracle_text`, `artist` e
// `image_uris` em cada `card_faces[]`, não no topo; a imagem é a de `card_faces[0]`.
import { z } from 'zod';

import { RARIDADES } from './scryfall/projecao.js';
import type { CartaScryfall } from './scryfall/cliente-scryfall.js';

/** Separador dos textos das faces, o mesmo que a Scryfall usa em `name` e `type_line`. */
const SEPARADOR_DE_FACES = '\n//\n';

const imagens = z.object({ normal: z.string().optional() }).optional();

const face = z.object({
  oracle_text: z.string().optional(),
  artist: z.string().optional(),
  image_uris: imagens,
});

const cartaDoSnapshot = z.object({
  name: z.string().min(1),
  set_name: z.string().min(1),
  rarity: z.enum(RARIDADES),
  type_line: z.string().min(1),
  oracle_text: z.string().optional(),
  artist: z.string().optional(),
  image_uris: imagens,
  card_faces: z.array(face).optional(),
});

export interface CartaLida {
  readonly nome: string;
  readonly colecao: string;
  readonly raridade: string;
  readonly tipo: string;
  readonly textoOracle: string | null;
  readonly artista: string | null;
  /** `image_uris.normal`, ou o de `card_faces[0]`; `null` se a carta não tiver imagem. */
  readonly urlDaImagem: string | null;
}

function textoDasFaces(faces: readonly z.infer<typeof face>[]): string | null {
  const textos = faces.map((f) => f.oracle_text).filter((t): t is string => t !== undefined);
  return textos.length === 0 ? null : textos.join(SEPARADOR_DE_FACES);
}

/** Campos do snapshot; `undefined` se a carta não tiver a forma esperada. */
export function lerCartaDoSnapshot(carta: CartaScryfall): CartaLida | undefined {
  const lido = cartaDoSnapshot.safeParse(carta);
  if (!lido.success) return undefined;
  const c = lido.data;
  const faces = c.card_faces ?? [];
  const primeira = faces[0];
  return {
    nome: c.name,
    colecao: c.set_name,
    raridade: c.rarity,
    tipo: c.type_line,
    textoOracle: c.oracle_text ?? textoDasFaces(faces),
    artista: c.artist ?? primeira?.artist ?? null,
    urlDaImagem: c.image_uris?.normal ?? primeira?.image_uris?.normal ?? null,
  };
}
