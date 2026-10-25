// Projeção da carta da busca (specs/005 §Busca: imagemUrl = image_uris.small, ou
// card_faces[0].image_uris.small em dupla-face, ou null).
import { describe, expect, it } from 'vitest';

import {
  lerCarta,
  lerListaDaBusca,
  lerPaginaGuardada,
} from '../../../../src/modules/catalogo/scryfall/projecao.js';

const ID = '11111111-1111-4111-8111-111111111111';

function carta(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ID,
    name: 'Lightning Bolt',
    set_name: 'Alpha',
    rarity: 'common',
    type_line: 'Instant',
    artist: 'Christopher Rush',
    ...extra,
  };
}

function lista(cartas: unknown[]): unknown {
  return { object: 'list', total_cards: 400, has_more: true, data: cartas };
}

describe('lerListaDaBusca', () => {
  it('projeta os campos da CartaDaBusca e o total_cards', () => {
    const pagina = lerListaDaBusca(
      lista([carta({ image_uris: { small: 'https://cards.scryfall.io/small/a.jpg' } })]),
    );

    expect(pagina).toEqual({
      total: 400,
      cartas: [
        {
          scryfallId: ID,
          nome: 'Lightning Bolt',
          colecao: 'Alpha',
          raridade: 'common',
          tipo: 'Instant',
          artista: 'Christopher Rush',
          imagemUrl: 'https://cards.scryfall.io/small/a.jpg',
        },
      ],
    });
  });

  it('dupla-face usa card_faces[0].image_uris.small', () => {
    const pagina = lerListaDaBusca(
      lista([
        carta({
          card_faces: [
            { image_uris: { small: 'https://cards.scryfall.io/small/frente.jpg' } },
            { image_uris: { small: 'https://cards.scryfall.io/small/verso.jpg' } },
          ],
        }),
      ]),
    );

    expect(pagina?.cartas[0]?.imagemUrl).toBe('https://cards.scryfall.io/small/frente.jpg');
  });

  it('sem imagem e sem artista: imagemUrl e artista null', () => {
    const semArtista = carta();
    delete semArtista['artist'];

    const pagina = lerListaDaBusca(lista([semArtista]));

    expect(pagina?.cartas[0]).toMatchObject({ imagemUrl: null, artista: null });
  });

  it.each([
    ['raridade fora do enum', lista([carta({ rarity: 'lendaria' })])],
    ['id que não é UUID', lista([carta({ id: 'x' })])],
    ['imagem que não é URL http(s)', lista([carta({ image_uris: { small: 'javascript:1' } })])],
    ['sem data', { total_cards: 1 }],
    ['não é objeto', 'texto'],
  ])('recusa corpo inválido: %s', (_, corpo) => {
    expect(lerListaDaBusca(corpo)).toBeUndefined();
  });
});

describe('lerCarta e lerPaginaGuardada', () => {
  it('lerCarta mantém o objeto inteiro e recusa o que não tem id UUID', () => {
    expect(lerCarta(carta({ oracle_text: 'Causa 3 de dano.' }))).toMatchObject({
      id: ID,
      oracle_text: 'Causa 3 de dano.',
    });
    expect(lerCarta({ id: 'x' })).toBeUndefined();
    expect(lerCarta(null)).toBeUndefined();
  });

  it('lerPaginaGuardada trata cache corrompido como miss', () => {
    expect(lerPaginaGuardada('{')).toBeUndefined();
    expect(lerPaginaGuardada('{"total":1}')).toBeUndefined();
    expect(lerPaginaGuardada('{"total":0,"cartas":[]}')).toEqual({ total: 0, cartas: [] });
  });
});
