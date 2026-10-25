// CSRF por double-submit (specs/003 §Comportamento): cookie `csrf_token` (não httpOnly) e header
// `X-CSRF-Token` iguais, comparados em tempo constante, em todo POST/PUT/PATCH/DELETE da API.
import { randomBytes, timingSafeEqual } from 'node:crypto';

export const METODOS_COM_CSRF: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const BYTES_DO_TOKEN_CSRF = 32;

export function gerarTokenCsrf(): string {
  return randomBytes(BYTES_DO_TOKEN_CSRF).toString('base64url');
}

/**
 * Cookie e header presentes, textos não vazios e iguais. O comprimento é conferido antes do
 * timingSafeEqual, que exige buffers do mesmo tamanho. Header repetido (lista) é recusado.
 */
export function csrfConfere(cookie: unknown, header: unknown): boolean {
  if (typeof cookie !== 'string' || typeof header !== 'string' || cookie === '') {
    return false;
  }
  const esperado = Buffer.from(cookie, 'utf8');
  const recebido = Buffer.from(header, 'utf8');
  return esperado.length === recebido.length && timingSafeEqual(esperado, recebido);
}
