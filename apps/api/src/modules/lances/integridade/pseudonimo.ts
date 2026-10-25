// Pseudônimo do licitante por lote (specs/008 §Técnica e §Chaves: PSEUDONYM_HMAC_KEY).
import { createHmac } from 'node:crypto';

const TAMANHO_DA_CHAVE = 32;
const CARACTERES_DO_SUFIXO = 6;

/**
 * `"Licitante #" + hex(HMAC-SHA256(chave, loteId + ":" + userId))[0..6]`: estável no lote e
 * diferente entre lotes. `chave` são os 32 bytes decodificados de `PSEUDONYM_HMAC_KEY`.
 */
export function pseudonimo(chave: Uint8Array, loteId: string, userId: string): string {
  if (chave.length !== TAMANHO_DA_CHAVE) throw new Error('chave do pseudônimo deve ter 32 bytes');
  const hmac = createHmac('sha256', chave).update(`${loteId}:${userId}`, 'utf8').digest('hex');
  return `Licitante #${hmac.slice(0, CARACTERES_DO_SUFIXO)}`;
}
