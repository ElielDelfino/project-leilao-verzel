// Access token JWT HS256 (jose 6.2.13) e refresh token opaco (specs/003 §Comportamento, ADR 0027).
import { createHash, randomBytes } from 'node:crypto';

import { errors, jwtVerify, SignJWT } from 'jose';

import { ehPapel, type UsuarioDaSessao } from '../../common/auth/sessao.js';

/** 15 minutos (specs/003 §Cookies: Max-Age do access_token). */
export const DURACAO_DO_ACCESS_TOKEN_S = 900;

const ALGORITMO = 'HS256';
const BYTES_DO_REFRESH_TOKEN = 32;
const FORMATO_DO_REFRESH_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Emite o access token: claims `sub` e `papel`, `iat` e `exp` (sem nome nem e-mail). */
export async function emitirAccessToken(
  chave: Uint8Array,
  usuario: UsuarioDaSessao,
  agora: Date = new Date(),
): Promise<string> {
  const emitidoEm = Math.floor(agora.getTime() / 1000);
  return new SignJWT({ papel: usuario.papel })
    .setProtectedHeader({ alg: ALGORITMO, typ: 'JWT' })
    .setSubject(usuario.id)
    .setIssuedAt(emitidoEm)
    .setExpirationTime(emitidoEm + DURACAO_DO_ACCESS_TOKEN_S)
    .sign(chave);
}

/**
 * Verifica assinatura, `alg` (só HS256) e expiração. Qualquer token recusado pela jose (expirado,
 * outra chave, outro alg, malformado) ou com claims fora do formato → undefined. Outro erro
 * (falha inesperada da biblioteca) é repassado.
 */
export async function verificarAccessToken(
  chave: Uint8Array,
  token: string,
): Promise<UsuarioDaSessao | undefined> {
  let claims: Record<string, unknown>;
  try {
    ({ payload: claims } = await jwtVerify(token, chave, {
      algorithms: [ALGORITMO],
      requiredClaims: ['sub', 'exp', 'iat'],
    }));
  } catch (erro: unknown) {
    if (erro instanceof errors.JOSEError) {
      return undefined;
    }
    throw erro;
  }
  const { sub, papel } = claims;
  if (typeof sub !== 'string' || !UUID.test(sub) || !ehPapel(papel)) {
    return undefined;
  }
  return { id: sub, papel };
}

export interface RefreshTokenNovo {
  /** Vai só para o cookie; nunca para o banco nem para o log. */
  readonly token: string;
  /** SHA-256 do token: o que fica em `refresh_tokens.token_hash`. */
  readonly hash: Buffer;
}

function sha256(texto: string): Buffer {
  return createHash('sha256').update(texto).digest();
}

/** Refresh token opaco de 256 bits, em base64url (43 caracteres). */
export function gerarRefreshToken(): RefreshTokenNovo {
  const token = randomBytes(BYTES_DO_REFRESH_TOKEN).toString('base64url');
  return { token, hash: sha256(token) };
}

/** Hash do refresh token recebido no cookie; undefined se o texto não tiver o formato. */
export function hashDoRefreshToken(token: string): Buffer | undefined {
  return FORMATO_DO_REFRESH_TOKEN.test(token) ? sha256(token) : undefined;
}
