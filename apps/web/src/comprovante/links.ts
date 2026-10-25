// A SPA nunca usa a URL do servidor em `href` nem em `src`: extrai o identificador e monta a
// própria (specs/012 §Comportamento "Links e imagens que vêm da API", ADR 0029).
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const FORMATO_AUDITORIA = new RegExp(`^/auditoria/(${UUID})$`);
const FORMATO_IMAGEM = new RegExp(`^/api/imagens/(${UUID})$`);

/** `/auditoria/{loteId}` do servidor → rota da SPA; `null` se o formato não casa. */
export function rotaDeAuditoria(auditoriaUrl: string): string | null {
  const loteId = FORMATO_AUDITORIA.exec(auditoriaUrl)?.[1];
  return loteId === undefined ? null : `/auditoria/${encodeURIComponent(loteId)}`;
}

/** `/api/imagens/{snapshotId}` do servidor → `src` montado pela SPA; `null` se não casa. */
export function origemDaImagem(imagemUrl: string): string | null {
  const snapshotId = FORMATO_IMAGEM.exec(imagemUrl)?.[1];
  return snapshotId === undefined ? null : `/api/imagens/${encodeURIComponent(snapshotId)}`;
}

/** URL completa do comprovante, sempre de `window.location.origin` e do `:codigo` da rota. */
export function urlDoComprovante(codigo: string): string {
  return `${window.location.origin}/comprovantes/${encodeURIComponent(codigo)}`;
}
