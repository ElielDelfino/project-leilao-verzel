import { type Auditoria, obterChaves } from '../api/auditoria';
import {
  type ChavePublicada,
  ErroDeContextoInseguro,
  type Problema,
  verificarCadeia,
} from './verificador';

export type ResultadoLocal =
  | {
      tipo: 'concluida';
      veredito: 'integro' | 'adulterado';
      problemas: readonly Problema[];
      keyIdsUsados: readonly string[];
    }
  | { tipo: 'sem-crypto' }
  | { tipo: 'falha' };

function semCryptoSubtle(): boolean {
  return globalThis.crypto?.subtle === undefined;
}

async function verificar(
  loteId: string,
  auditoria: Auditoria,
  chaves: readonly ChavePublicada[],
  chavesAtualizadas: boolean,
) {
  return verificarCadeia({
    loteId,
    lances: auditoria.lances,
    selo: auditoria.selo,
    chaves,
    chavesAtualizadas,
  });
}

/**
 * Verificação no navegador (specs/008 §Verificação, specs/012 §Auditoria). Usa o `loteId` da rota.
 * Um `keyId` fora da lista refaz a consulta de chaves uma vez antes de acusar `CHAVE_DESCONHECIDA`.
 * Qualquer exceção vira resultado "não verificável"; nunca um veredito.
 */
export async function verificarNoNavegador(
  loteId: string,
  auditoria: Auditoria,
): Promise<ResultadoLocal> {
  if (semCryptoSubtle()) return { tipo: 'sem-crypto' };
  try {
    const primeira = await verificar(loteId, auditoria, await obterChaves(), false);
    const retorno =
      primeira.tipo === 'pendente'
        ? await verificar(loteId, auditoria, await obterChaves(), true)
        : primeira;
    if (retorno.tipo !== 'concluida') return { tipo: 'falha' };
    return {
      tipo: 'concluida',
      veredito: retorno.veredito,
      problemas: retorno.problemas,
      keyIdsUsados: retorno.keyIdsUsados,
    };
  } catch (erro) {
    return erro instanceof ErroDeContextoInseguro ? { tipo: 'sem-crypto' } : { tipo: 'falha' };
  }
}
