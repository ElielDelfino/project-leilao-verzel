// Canônico e hash do lance e do selo (specs/008 §Forma canônica), com validação igual à da API.
import {
  canonicalizar,
  ErroDeCanonico,
  exigirHex64,
  exigirInstante,
  exigirInteiro,
  exigirLoteId,
  sha256DoTexto,
} from './canonico';
import type { LanceDaCadeia, SeloDoLote } from './tipos';

export function canonicoDoLance(loteId: string, lance: LanceDaCadeia): string {
  exigirLoteId(loteId);
  exigirInteiro('seq', lance.seq, 1);
  exigirHex64('hashAnterior', lance.hashAnterior);
  exigirInstante('criadoEm', lance.criadoEm);
  return canonicalizar({
    criadoEm: lance.criadoEm,
    hashAnterior: lance.hashAnterior,
    loteId,
    pseudonimo: lance.pseudonimo,
    seq: lance.seq,
    valorCentavos: lance.valorCentavos,
  });
}

export function canonicoDoSelo(loteId: string, selo: SeloDoLote): string {
  exigirLoteId(loteId);
  if (selo.status !== 'encerrado' && selo.status !== 'cancelado') {
    throw new ErroDeCanonico('campo status: valor desconhecido');
  }
  exigirInteiro('totalLances', selo.totalLances, 0);
  exigirHex64('hashFinal', selo.hashFinal);
  exigirInstante('seladoEm', selo.seladoEm);
  return canonicalizar({
    hashFinal: selo.hashFinal,
    loteId,
    seladoEm: selo.seladoEm,
    status: selo.status,
    totalLances: selo.totalLances,
    valorArremateCentavos: selo.valorArremateCentavos,
    vencedorPseudonimo: selo.vencedorPseudonimo,
  });
}

/** Hash recalculado, ou `null` se os dados estão fora da forma canônica (não reproduzem o assinado). */
export async function recalcular(canonico: () => string): Promise<string | null> {
  try {
    return await sha256DoTexto(canonico());
  } catch (erro: unknown) {
    if (erro instanceof ErroDeCanonico) return null;
    throw erro;
  }
}
