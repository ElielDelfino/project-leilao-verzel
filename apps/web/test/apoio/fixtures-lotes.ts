import { http, HttpResponse, type HttpHandler } from 'msw';

import type { SchemasApi } from '@leilao/contracts';

import { ORIGEM } from './servidor';

type Lote = SchemasApi['Lote'];
type LoteDetalhe = SchemasApi['LoteDetalhe'];

const ID_BASE = '0192f3a0-0000-7000-8000-0000000001';

/** Lote ao vivo com lance; sobrescreva os campos que o teste precisa. */
export function criarLote(sobrescritas: Partial<Lote> = {}): Lote {
  return {
    id: `${ID_BASE}01`,
    titulo: 'Black Lotus em estado raro',
    status: 'ao_vivo',
    cartaNome: 'Black Lotus',
    raridade: 'rare',
    imagemUrl: '/api/imagens/0192f3a0-0000-7000-8000-0000000002a1',
    inicioEm: '2026-10-24T13:00:00Z',
    fimEm: '2026-10-26T15:30:00Z',
    lanceInicialCentavos: 10_000,
    incrementoMinimoCentavos: 500,
    lanceAtualCentavos: 123_456,
    precoAtualCentavos: 123_456,
    totalLances: 3,
    valorArremateCentavos: null,
    criadoEm: '2026-10-24T12:00:00Z',
    ...sobrescritas,
  };
}

/** Detalhe de um lote ao vivo com lance, sem posição do usuário. */
export function criarLoteDetalhe(sobrescritas: Partial<LoteDetalhe> = {}): LoteDetalhe {
  return {
    id: `${ID_BASE}01`,
    titulo: 'Black Lotus em estado raro',
    descricao: 'Carta em ótimo estado.',
    status: 'ao_vivo',
    cartaNome: 'Black Lotus',
    raridade: 'rare',
    carta: {
      scryfallId: '0192f3a0-0000-7000-8000-0000000003a1',
      nome: 'Black Lotus',
      colecao: 'Limited Edition Alpha',
      raridade: 'rare',
      tipo: 'Artifact',
      textoOracle: '{T}, Sacrifice Black Lotus: Add three mana of any one color.',
      artista: 'Christopher Rush',
    },
    imagemUrl: '/api/imagens/0192f3a0-0000-7000-8000-0000000002a1',
    inicioEm: '2026-10-24T13:00:00Z',
    fimEm: '2026-10-26T15:30:00Z',
    fimOriginalEm: '2026-10-26T15:30:00Z',
    lanceInicialCentavos: 10_000,
    incrementoMinimoCentavos: 500,
    lanceAtualCentavos: 123_456,
    precoAtualCentavos: 123_456,
    totalLances: 3,
    valorArremateCentavos: null,
    suaPosicao: null,
    criadoEm: '2026-10-24T12:00:00Z',
    ...sobrescritas,
  };
}

export interface RegistroDaListagem {
  /** Query string de cada `GET /api/lotes`, na ordem das chamadas. */
  consultas: URLSearchParams[];
}

/** `GET /api/lotes` com a lista e o total dados; registra as consultas recebidas. */
export function servirLotes(
  lotes: Lote[],
  total = lotes.length,
): { handler: HttpHandler; registro: RegistroDaListagem } {
  const registro: RegistroDaListagem = { consultas: [] };
  const handler = http.get(`${ORIGEM}/api/lotes`, ({ request }) => {
    const consulta = new URL(request.url).searchParams;
    registro.consultas.push(consulta);
    return HttpResponse.json({
      sucesso: true,
      dados: lotes,
      meta: { total, pagina: Number(consulta.get('pagina')) || 1, limite: 24 },
    });
  });
  return { handler, registro };
}

export function servirDetalhe(lote: LoteDetalhe): HttpHandler {
  return http.get(`${ORIGEM}/api/lotes/${lote.id}`, () =>
    HttpResponse.json({ sucesso: true, dados: lote }),
  );
}
