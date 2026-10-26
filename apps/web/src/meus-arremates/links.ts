const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const IMAGEM = new RegExp(`^/api/imagens/(${UUID})$`, 'i');
const AUDITORIA = new RegExp(`^/auditoria/(${UUID})$`, 'i');
const UUID_ESTRITO = new RegExp(`^${UUID}$`, 'i');

/** Monta `/api/imagens/{id}` a partir do UUID do snapshot; nunca devolve a URL do servidor. */
export function imagemDoSnapshot(imagemUrl: string): string | null {
  const id = IMAGEM.exec(imagemUrl)?.[1];
  return id ? `/api/imagens/${id}` : null;
}

/** Rota interna da auditoria, ou `null` se a URL do servidor não for `/auditoria/{uuid}`. */
export function rotaDeAuditoria(auditoriaUrl: string): string | null {
  const id = AUDITORIA.exec(auditoriaUrl)?.[1];
  return id ? `/auditoria/${id}` : null;
}

export function rotaDeComprovante(codigo: string): string {
  return `/comprovantes/${encodeURIComponent(codigo)}`;
}

/** Rota da sala do lote, ou `null` se o id não for um UUID. */
export function rotaDoLote(id: string): string | null {
  return UUID_ESTRITO.test(id) ? `/lotes/${id}` : null;
}
