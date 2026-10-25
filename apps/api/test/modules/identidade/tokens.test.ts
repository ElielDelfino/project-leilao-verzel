// Unidade: access token JWT HS256 e refresh token opaco (specs/003 §Comportamento, ADR 0027).
import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { decodeJwt, decodeProtectedHeader, SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';

import {
  DURACAO_DO_ACCESS_TOKEN_S,
  emitirAccessToken,
  gerarRefreshToken,
  hashDoRefreshToken,
  verificarAccessToken,
} from '../../../src/modules/identidade/tokens.js';

const CHAVE = new Uint8Array(randomBytes(32));
const USUARIO = { id: randomUUID(), papel: 'licitante' } as const;

function base64url(texto: string): string {
  return Buffer.from(texto).toString('base64url');
}

describe('emitirAccessToken', () => {
  it('HS256 com sub e papel, 15 minutos, sem nome nem e-mail', async () => {
    const agora = new Date('2026-10-25T12:00:00Z');

    const token = await emitirAccessToken(CHAVE, USUARIO, agora);

    expect(decodeProtectedHeader(token)).toEqual({ alg: 'HS256', typ: 'JWT' });
    const claims = decodeJwt(token);
    expect(claims).toEqual({
      sub: USUARIO.id,
      papel: 'licitante',
      iat: agora.getTime() / 1000,
      exp: agora.getTime() / 1000 + 900,
    });
    expect(DURACAO_DO_ACCESS_TOKEN_S).toBe(900);
  });
});

describe('verificarAccessToken', () => {
  it('devolve o usuário da sessão para um token válido', async () => {
    const token = await emitirAccessToken(CHAVE, USUARIO);

    expect(await verificarAccessToken(CHAVE, token)).toEqual(USUARIO);
  });

  it('token expirado → undefined', async () => {
    const token = await emitirAccessToken(CHAVE, USUARIO, new Date(Date.now() - 16 * 60_000));

    expect(await verificarAccessToken(CHAVE, token)).toBeUndefined();
  });

  it('assinado com outra chave → undefined', async () => {
    const token = await emitirAccessToken(new Uint8Array(randomBytes(32)), USUARIO);

    expect(await verificarAccessToken(CHAVE, token)).toBeUndefined();
  });

  it('alg diferente de HS256 (HS512 com a mesma chave) → undefined', async () => {
    const token = await new SignJWT({ papel: 'licitante' })
      .setProtectedHeader({ alg: 'HS512' })
      .setSubject(USUARIO.id)
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(CHAVE);

    expect(await verificarAccessToken(CHAVE, token)).toBeUndefined();
  });

  it('alg none (sem assinatura) → undefined', async () => {
    const agora = Math.floor(Date.now() / 1000);
    const corpo = base64url(
      JSON.stringify({ sub: USUARIO.id, papel: 'leiloeiro', iat: agora, exp: agora + 900 }),
    );
    const token = `${base64url('{"alg":"none","typ":"JWT"}')}.${corpo}.`;

    expect(await verificarAccessToken(CHAVE, token)).toBeUndefined();
  });

  it.each([
    ['papel desconhecido', { papel: 'admin' }, USUARIO.id],
    ['sem papel', {}, USUARIO.id],
    ['sub que não é UUID', { papel: 'licitante' }, 'nao-e-uuid'],
  ])('claims inválidas (%s) → undefined', async (_, claims, sub) => {
    const token = await new SignJWT(claims)
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(sub)
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(CHAVE);

    expect(await verificarAccessToken(CHAVE, token)).toBeUndefined();
  });

  it('sem exp → undefined', async () => {
    const token = await new SignJWT({ papel: 'licitante' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(USUARIO.id)
      .setIssuedAt()
      .sign(CHAVE);

    expect(await verificarAccessToken(CHAVE, token)).toBeUndefined();
  });

  it.each(['', 'lixo', 'a.b.c'])('texto que não é JWT (%j) → undefined', async (texto) => {
    expect(await verificarAccessToken(CHAVE, texto)).toBeUndefined();
  });
});

describe('refresh token opaco', () => {
  it('256 bits em base64url (43 caracteres) e o SHA-256 como hash', () => {
    const { token, hash } = gerarRefreshToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(hash.equals(createHash('sha256').update(token).digest())).toBe(true);
  });

  it('cada token é novo', () => {
    expect(gerarRefreshToken().token).not.toBe(gerarRefreshToken().token);
  });

  it('hashDoRefreshToken recusa texto fora do formato (undefined)', () => {
    const { token, hash } = gerarRefreshToken();

    expect(hashDoRefreshToken(token)?.equals(hash)).toBe(true);
    expect(hashDoRefreshToken('')).toBeUndefined();
    expect(hashDoRefreshToken(`${token}A`)).toBeUndefined();
    expect(hashDoRefreshToken('x'.repeat(10_000))).toBeUndefined();
  });
});
