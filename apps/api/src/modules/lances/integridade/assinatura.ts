// Chaves Ed25519, keyId, assinatura e verificação com node:crypto (specs/008 §Técnica e §Chaves, ADR 0023).
// Nada aqui registra, devolve em erro ou expõe a seed: a chave privada só circula como KeyObject.
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  type KeyObject,
  sign,
  verify,
} from 'node:crypto';

/** Chave de assinatura pronta para uso; a seed não fica guardada. */
export interface ChavesDeAssinatura {
  readonly chavePrivada: KeyObject;
  /** Os 32 bytes da chave pública (RFC 8032 §5.1.5). */
  readonly chavePublica: Uint8Array;
  /** 16 primeiros hex minúsculos de SHA-256(chave pública). */
  readonly keyId: string;
}

const TAMANHO_DA_CHAVE = 32;
const TAMANHO_DA_ASSINATURA = 64;
// Prefixos DER fixos do Ed25519 (RFC 8410): PKCS#8 com a seed e SPKI com a chave pública.
const PREFIXO_PKCS8 = Buffer.from('302e020100300506032b657004220420', 'hex');
const PREFIXO_SPKI = Buffer.from('302a300506032b6570032100', 'hex');
const HEX_64 = /^[0-9a-f]{64}$/;
const BASE64URL_DA_ASSINATURA = /^[A-Za-z0-9_-]{86}$/;
const TAMANHO_DO_KEY_ID = 16;

function exigirTamanho(bytes: Uint8Array, nome: string): void {
  if (bytes.length !== TAMANHO_DA_CHAVE) throw new Error(`${nome} Ed25519 deve ter 32 bytes`);
}

/** keyId da chave pública (specs/008 §Chaves). */
export function keyIdDaChave(chavePublica: Uint8Array): string {
  exigirTamanho(chavePublica, 'chave pública');
  return createHash('sha256').update(chavePublica).digest('hex').slice(0, TAMANHO_DO_KEY_ID);
}

/** Deriva chave privada, chave pública e keyId da seed de 32 bytes (RFC 8032 §5.1.5). */
export function derivarChaves(seed: Uint8Array): ChavesDeAssinatura {
  exigirTamanho(seed, 'seed');
  const chavePrivada = createPrivateKey({
    key: Buffer.concat([PREFIXO_PKCS8, seed]),
    format: 'der',
    type: 'pkcs8',
  });
  const spki = createPublicKey(chavePrivada).export({ format: 'der', type: 'spki' });
  const chavePublica = new Uint8Array(spki.subarray(PREFIXO_SPKI.length));
  return { chavePrivada, chavePublica, keyId: keyIdDaChave(chavePublica) };
}

/** Assinatura Ed25519 sobre os 32 bytes do hash (não sobre o texto hex), em base64url sem padding. */
export function assinar(chavePrivada: KeyObject, hashHex: string): string {
  if (!HEX_64.test(hashHex)) throw new Error('hash deve ser hex minúsculo de 64 caracteres');
  return sign(null, Buffer.from(hashHex, 'hex'), chavePrivada).toString('base64url');
}

function importarChavePublica(chavePublica: Uint8Array): KeyObject | null {
  if (chavePublica.length !== TAMANHO_DA_CHAVE) return null;
  try {
    return createPublicKey({
      key: Buffer.concat([PREFIXO_SPKI, chavePublica]),
      format: 'der',
      type: 'spki',
    });
  } catch {
    // Bytes que não formam um ponto válido não verificam nada: a assinatura é inválida.
    return null;
  }
}

/** Decodifica a assinatura só na forma canônica (86 caracteres que se recodificam iguais). */
function decodificarAssinatura(assinatura: string): Buffer | null {
  if (!BASE64URL_DA_ASSINATURA.test(assinatura)) return null;
  const bytes = Buffer.from(assinatura, 'base64url');
  if (bytes.length !== TAMANHO_DA_ASSINATURA || bytes.toString('base64url') !== assinatura)
    return null;
  return bytes;
}

/**
 * `true` só se `assinatura` é a Ed25519 válida dos 32 bytes de `hashHex` com `chavePublica`.
 * Entrada malformada (hash, assinatura ou chave) devolve `false`, sem lançar.
 */
export function verificar(chavePublica: Uint8Array, hashHex: string, assinatura: string): boolean {
  if (!HEX_64.test(hashHex)) return false;
  const bytes = decodificarAssinatura(assinatura);
  const chave = importarChavePublica(chavePublica);
  if (bytes === null || chave === null) return false;
  return verify(null, Buffer.from(hashHex, 'hex'), chave, bytes);
}
