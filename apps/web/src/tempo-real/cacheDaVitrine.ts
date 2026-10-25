import type { EventosDoServidor } from '@leilao/contracts';
import type { QueryClient } from '@tanstack/react-query';

import type { Lote, PaginaDeLotes } from '../api/lotes';

/** Prefixo das consultas da lista da vitrine (`['lotes', 'vitrine', <filtros>]`). */
export const CHAVE_DA_VITRINE = ['lotes', 'vitrine'] as const;

function atualizarLote(
  queryClient: QueryClient,
  loteId: string,
  alterar: (lote: Lote) => Lote,
): void {
  queryClient.setQueriesData<PaginaDeLotes>({ queryKey: CHAVE_DA_VITRINE }, (pagina) => {
    if (!pagina?.lotes.some((lote) => lote.id === loteId)) return pagina;
    return {
      ...pagina,
      lotes: pagina.lotes.map((lote) => (lote.id === loteId ? alterar(lote) : lote)),
    };
  });
}

/** `lance_aceito`: lance atual, preço, total de lances e fim (anti-sniping) do card. */
export function aplicarLanceAceito(
  queryClient: QueryClient,
  evento: EventosDoServidor['lance_aceito'],
): void {
  atualizarLote(queryClient, evento.loteId, (lote) => {
    // Evento atrasado ou repetido nunca volta o card no tempo.
    if (evento.totalLances < lote.totalLances) return lote;
    return {
      ...lote,
      lanceAtualCentavos: evento.valorCentavos,
      precoAtualCentavos: evento.valorCentavos,
      totalLances: evento.totalLances,
      fimEm: evento.fimEm,
    };
  });
}

/** `fim_estendido`: só o fim do card. */
export function aplicarFimEstendido(
  queryClient: QueryClient,
  evento: EventosDoServidor['fim_estendido'],
): void {
  atualizarLote(queryClient, evento.loteId, (lote) => ({ ...lote, fimEm: evento.fimEm }));
}

/** O lote muda de aba (ou sai da lista): refaz as consultas da vitrine. */
export function invalidarVitrine(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: CHAVE_DA_VITRINE });
}
