// Nomes dos rooms do namespace /leilao (specs/009 §Comportamento).

/** Room público da vitrine ao vivo (ADR 0031). */
export const SALA_DA_VITRINE = 'vitrine';

export const PREFIXO_DA_SALA_DO_LOTE = 'lote:';

export function salaDoLote(loteId: string): string {
  return `${PREFIXO_DA_SALA_DO_LOTE}${loteId}`;
}

/** Room privado do usuário autenticado; só o handshake coloca um socket nele. */
export function salaDoUsuario(usuarioId: string): string {
  return `usuario:${usuarioId}`;
}
