import { ErroDaApi } from '../api/erro';
import { mensagemDoErro } from '../mensagens/erros';

export const MENSAGEM_BUSCA_VAZIA = 'Digite de 1 a 200 caracteres.';
export const MENSAGEM_SINTAXE = 'A Scryfall não entendeu esta busca. Confira a sintaxe.';
export const MENSAGEM_CARTA_RECUSADA = 'Não foi possível usar esta carta. Escolha outra.';

export function campoDoErro(erro: unknown): unknown {
  return erro instanceof ErroDaApi ? erro.detalhes?.['campo'] : undefined;
}

/** Segundos de espera: `detalhes.tenteNovamenteEm`, ou o `Retry-After` quando não há detalhes. */
function segundosDeEspera(erro: ErroDaApi): number | undefined {
  const detalhe = erro.detalhes?.['tenteNovamenteEm'];
  return typeof detalhe === 'number' && Number.isInteger(detalhe) && detalhe > 0
    ? detalhe
    : erro.retryAfterSegundos;
}

/** Texto de um erro da busca ou da criação de lote, pelo mapa único de `mensagens/erros.ts`. */
export function textoDoErroDoCatalogo(erro: unknown): string {
  if (!(erro instanceof ErroDaApi)) return mensagemDoErro('INDISPONIVEL');
  if (erro.codigo === 'DADOS_INVALIDOS') {
    const campo = campoDoErro(erro);
    if (campo === 'q') return MENSAGEM_SINTAXE;
    if (campo === 'scryfallId') return MENSAGEM_CARTA_RECUSADA;
  }
  const segundos = segundosDeEspera(erro);
  return mensagemDoErro(erro.codigo, segundos === undefined ? {} : { segundos });
}
