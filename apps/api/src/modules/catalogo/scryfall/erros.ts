// Erros do catálogo (specs/005 §Busca e specs/001 §Erros). O status da Scryfall nunca chega ao
// cliente, e nenhuma mensagem leva URL, host ou detalhe do upstream.
import { ErroApi } from '../../../common/erros/erro-api.js';

/** `tenteNovamenteEm` do Redis fora ou da falha do upstream sem circuito aberto (specs/005). */
export const ESPERA_PADRAO_S = 5;
/** `tenteNovamenteEm` do bucket sem ficha (specs/005). */
export const ESPERA_OCUPADO_S = 1;

const MS_POR_S = 1000;

/** Segundos inteiros ≥ 1 a partir de milissegundos, arredondando para cima. */
export function segundosParaTentar(ms: number): number {
  return Math.max(1, Math.ceil(ms / MS_POR_S));
}

export function catalogoIndisponivel(tenteNovamenteEm: number = ESPERA_PADRAO_S): ErroApi {
  return new ErroApi({
    codigo: 'CATALOGO_INDISPONIVEL',
    status: 503,
    mensagem: 'O catálogo de cartas está indisponível no momento.',
    detalhes: { tenteNovamenteEm },
    retryAfterSegundos: tenteNovamenteEm,
  });
}

export function catalogoOcupado(): ErroApi {
  return new ErroApi({
    codigo: 'CATALOGO_OCUPADO',
    status: 503,
    mensagem: 'O catálogo de cartas está ocupado. Tente de novo em instantes.',
    detalhes: { tenteNovamenteEm: ESPERA_OCUPADO_S },
    retryAfterSegundos: ESPERA_OCUPADO_S,
  });
}

export function campoInvalido(campo: 'q' | 'scryfallId'): ErroApi {
  return new ErroApi({
    codigo: 'DADOS_INVALIDOS',
    status: 422,
    mensagem: 'Dados inválidos.',
    detalhes: { campo },
  });
}
