// Unidade: chaves Ed25519, keyId, assinatura e verificação (specs/008 §Chaves e §Técnica).
import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  assinar,
  derivarChaves,
  keyIdDaChave,
  verificar,
} from '../../../../src/modules/lances/integridade/assinatura.js';

// Vetor público do RFC 8032 §7.1 TEST 1 (não é chave de nenhum ambiente).
const SEED_RFC8032_TEST1 = Buffer.from(
  '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60',
  'hex',
);
const HASH = 'af1bac38780142da599db0996414d71a5a5b98ad198b2c0c8f7a1bf55abdd8cb';

describe('derivarChaves', () => {
  it('deriva a chave pública e o keyId do vetor RFC 8032 TEST 1 (specs/008 §Chaves)', () => {
    const chaves = derivarChaves(new Uint8Array(SEED_RFC8032_TEST1));

    expect(Buffer.from(chaves.chavePublica).toString('base64url')).toBe(
      '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo',
    );
    expect(chaves.keyId).toBe('21fe31dfa154a261');
    expect(keyIdDaChave(chaves.chavePublica)).toBe('21fe31dfa154a261');
  });

  it.each([0, 31, 33, 64])('recusa seed de %i bytes sem citar o conteúdo', (tamanho) => {
    expect(() => derivarChaves(new Uint8Array(tamanho))).toThrow(/32 bytes/);
  });

  it('não expõe a seed no objeto devolvido nem na sua inspeção', () => {
    const seed = new Uint8Array(randomBytes(32));
    const chaves = derivarChaves(seed);
    const texto = JSON.stringify({ ...chaves, chavePrivada: String(chaves.chavePrivada) });

    expect(texto).not.toContain(Buffer.from(seed).toString('base64url'));
    expect(texto).not.toContain(Buffer.from(seed).toString('hex'));
    expect(Object.keys(chaves).sort()).toEqual(['chavePrivada', 'chavePublica', 'keyId']);
  });
});

describe('keyIdDaChave', () => {
  it('recusa chave pública que não tenha 32 bytes', () => {
    expect(() => keyIdDaChave(new Uint8Array(31))).toThrow(/32 bytes/);
  });
});

describe('assinar e verificar', () => {
  const { chavePrivada, chavePublica } = derivarChaves(new Uint8Array(randomBytes(32)));

  it('assina os 32 bytes do hash em base64url sem padding (86 caracteres)', () => {
    const assinatura = assinar(chavePrivada, HASH);

    expect(assinatura).toMatch(/^[A-Za-z0-9_-]{86}$/);
    expect(verificar(chavePublica, HASH, assinatura)).toBe(true);
  });

  it('é determinística (Ed25519)', () => {
    expect(assinar(chavePrivada, HASH)).toBe(assinar(chavePrivada, HASH));
  });

  it('assina os bytes do hash, não o texto hex', () => {
    const outra = derivarChaves(new Uint8Array(randomBytes(32)));
    expect(verificar(outra.chavePublica, HASH, assinar(chavePrivada, HASH))).toBe(false);
  });

  it.each(['', 'abc', HASH.toUpperCase(), `${HASH}00`, HASH.slice(2)])(
    'assinar recusa hash fora do formato hex minúsculo de 64 caracteres (%#)',
    (hash) => {
      expect(() => assinar(chavePrivada, hash)).toThrow(/hash/);
    },
  );

  it('recusa assinatura de outro hash', () => {
    const outroHash = HASH.replace(/^a/, 'b');
    expect(verificar(chavePublica, outroHash, assinar(chavePrivada, HASH))).toBe(false);
  });

  it('recusa assinatura feita com outra chave', () => {
    const outra = derivarChaves(new Uint8Array(randomBytes(32)));
    expect(verificar(chavePublica, HASH, assinar(outra.chavePrivada, HASH))).toBe(false);
  });

  it('recusa assinatura com um bit trocado', () => {
    const bytes = Buffer.from(assinar(chavePrivada, HASH), 'base64url');
    bytes[10] = (bytes[10] ?? 0) ^ 1;
    expect(verificar(chavePublica, HASH, bytes.toString('base64url'))).toBe(false);
  });

  it('recusa base64url não canônico, mesmo que decodifique para os mesmos bytes', () => {
    const assinatura = assinar(chavePrivada, HASH);
    // 64 bytes ocupam 512 dos 516 bits de 86 caracteres: os 4 bits baixos do último são zero
    // na forma canônica, então trocar o último pelo seguinte do alfabeto mantém os bytes.
    const alfabeto = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const indice = alfabeto.indexOf(assinatura.at(-1) ?? '');
    expect(indice % 16).toBe(0);
    const variante = assinatura.slice(0, -1) + (alfabeto[indice + 1] ?? '');
    expect(Buffer.from(variante, 'base64url')).toEqual(Buffer.from(assinatura, 'base64url'));
    expect(verificar(chavePublica, HASH, variante)).toBe(false);
  });

  it.each(['', 'abc', '='.repeat(86), `${'A'.repeat(84)}==`, 'A'.repeat(88)])(
    'recusa assinatura malformada sem lançar (%#)',
    (assinatura) => {
      expect(verificar(chavePublica, HASH, assinatura)).toBe(false);
    },
  );

  it('recusa hash malformado sem lançar', () => {
    expect(verificar(chavePublica, 'xyz', assinar(chavePrivada, HASH))).toBe(false);
  });

  it('recusa chave pública com tamanho errado sem lançar', () => {
    expect(verificar(new Uint8Array(31), HASH, assinar(chavePrivada, HASH))).toBe(false);
  });
});
