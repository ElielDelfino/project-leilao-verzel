// Unidades do módulo catalogo (specs/005): validação de `q` e `pagina`, If-None-Match, leitura da
// carta do snapshot (dupla-face) e o recorte da página de 25 sobre a de 175, sem rede nem banco.
import { describe, expect, it } from 'vitest';

import type { Env } from '../../../src/config/env.js';
import type { BancoVerificavel } from '../../../src/db/banco.js';
import { casaComEtag, etagDoSha256 } from '../../../src/modules/catalogo/catalogo.controller.js';
import { lerCartaDoSnapshot } from '../../../src/modules/catalogo/carta-do-snapshot.js';
import {
  esquemaDaPaginaDaBusca,
  esquemaDoQ,
  PipeDoCampo,
} from '../../../src/modules/catalogo/esquemas.js';
import type {
  CartaDaBusca,
  ClienteScryfall,
} from '../../../src/modules/catalogo/scryfall/cliente-scryfall.js';
import { ServicoDeCatalogo } from '../../../src/modules/catalogo/servico-de-catalogo.js';
import { ErroApi } from '../../../src/common/erros/erro-api.js';
import { ENV_DE_TESTE } from '../../helpers/app-de-teste.js';
import {
  ID_CARTA_DUPLA_FACE,
  ID_CARTA_SEM_IMAGEM,
  montarCatalogo,
} from '../../helpers/fixtures-scryfall/cartas.js';

function erroDe(fn: () => unknown): ErroApi {
  try {
    fn();
  } catch (erro: unknown) {
    if (erro instanceof ErroApi) return erro;
    throw erro;
  }
  throw new Error('não lançou');
}

describe('validação da busca', () => {
  const q = new PipeDoCampo(esquemaDoQ, 'q');
  const pagina = new PipeDoCampo(esquemaDaPaginaDaBusca, 'pagina');

  it('aceita q de 1 e de 200 caracteres e pagina de 1 a 500 (ausente → 1)', () => {
    expect(q.transform('a')).toBe('a');
    expect(q.transform('x'.repeat(200))).toHaveLength(200);
    expect(pagina.transform(undefined)).toBe(1);
    expect(pagina.transform('7')).toBe(7);
    expect(pagina.transform('500')).toBe(500);
  });

  it.each([[''], ['x'.repeat(201)], [' bolt'], ['bolt '], [undefined], [['a', 'b']]])(
    'q inválido (%j) → 422 com detalhes.campo q',
    (valor) => {
      const erro = erroDe(() => q.transform(valor));
      expect(erro.status).toBe(422);
      expect(erro.detalhes).toEqual({ campo: 'q' });
    },
  );

  it.each([['0'], ['501'], ['01'], ['1.5'], ['-1'], [''], ['abc'], [['1', '2']]])(
    'pagina inválida (%j) → 422 com detalhes.campo pagina',
    (valor) => {
      const erro = erroDe(() => pagina.transform(valor));
      expect(erro.status).toBe(422);
      expect(erro.detalhes).toEqual({ campo: 'pagina' });
    },
  );
});

describe('If-None-Match', () => {
  const etag = etagDoSha256(Buffer.alloc(32, 0xab));

  it('ETag é o hexadecimal minúsculo entre aspas', () => {
    expect(etag).toBe(`"${'ab'.repeat(32)}"`);
  });

  it.each([etag, `W/${etag}`, `"outro", ${etag}`, `W/"x",W/${etag}`, '*'])('casa com %s', (v) => {
    expect(casaComEtag(v, etag)).toBe(true);
  });

  it.each([undefined, '', '"outro"', etag.slice(1, -1), `${etag}x`])('não casa com %s', (v) => {
    expect(casaComEtag(v, etag)).toBe(false);
  });
});

describe('lerCartaDoSnapshot', () => {
  const catalogo = montarCatalogo('http://127.0.0.1:1');
  const carta = (id: string): Record<string, unknown> => {
    const achada = catalogo.find((c) => c.id === id);
    if (achada === undefined) throw new Error('fixture ausente');
    return { ...achada };
  };

  it('dupla-face: imagem, texto e artista de card_faces', () => {
    const lida = lerCartaDoSnapshot(carta(ID_CARTA_DUPLA_FACE));
    expect(lida?.urlDaImagem).toMatch(/\/imagens\/22222222-.*\.png$/);
    expect(lida?.textoOracle).toBe(
      'Texto de Delver of Secrets.\n//\nTexto de Insectile Aberration.',
    );
    expect(lida?.artista).toBe('Artista de Teste');
  });

  it('carta sem imagem: urlDaImagem null', () => {
    expect(lerCartaDoSnapshot(carta(ID_CARTA_SEM_IMAGEM))?.urlDaImagem).toBeNull();
  });

  it('forma inesperada → undefined', () => {
    expect(lerCartaDoSnapshot({ id: ID_CARTA_SEM_IMAGEM, rarity: 'lendária' })).toBeUndefined();
  });
});

describe('ServicoDeCatalogo.buscarCartas', () => {
  const pedidas: number[] = [];
  const cartaN = (n: number, imagemUrl: string | null): CartaDaBusca => ({
    scryfallId: `44444444-4444-4444-8444-${String(n).padStart(12, '0')}`,
    nome: `Carta ${n}`,
    colecao: 'Teste',
    raridade: 'common',
    tipo: 'Creature',
    artista: null,
    imagemUrl,
  });
  const cliente: ClienteScryfall = {
    buscar: (_q, paginaScryfall) => {
      pedidas.push(paginaScryfall);
      const cartas = Array.from({ length: 175 }, (_, i) =>
        cartaN(i, i === 1 ? 'https://evil.example/x.jpg' : `https://cards.scryfall.io/s/${i}.jpg`),
      );
      return Promise.resolve({ total: 400, cartas });
    },
    obterCarta: () => Promise.resolve(null),
  };
  const env: Env = ENV_DE_TESTE;
  const servico = new ServicoDeCatalogo({} as BancoVerificavel, cliente, env);

  it.each([
    [1, 1, 0],
    [7, 1, 150],
    [8, 2, 0],
    [14, 2, 150],
  ])(
    'pagina %i usa a página Scryfall %i a partir da carta %i',
    async (pagina, scryfall, inicio) => {
      pedidas.length = 0;
      const { dados, meta } = await servico.buscarCartas('bolt', pagina);
      expect(pedidas).toEqual([scryfall]);
      expect(dados).toHaveLength(25);
      expect(dados[0]?.nome).toBe(`Carta ${inicio}`);
      expect(dados[24]?.nome).toBe(`Carta ${inicio + 24}`);
      expect(meta).toEqual({ total: 400, pagina, limite: 25 });
    },
  );

  it('imagemUrl fora de https://cards.scryfall.io/ vira null', async () => {
    const { dados } = await servico.buscarCartas('bolt', 1);
    expect(dados[1]?.imagemUrl).toBeNull();
    expect(dados[0]?.imagemUrl).toBe('https://cards.scryfall.io/s/0.jpg');
  });
});
