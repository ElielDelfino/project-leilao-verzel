// Unidade: pseudônimo por lote com HMAC-SHA256 (specs/008 §Técnica e §Chaves).
import { createHmac, randomBytes, randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { pseudonimo } from '../../../../src/modules/lances/integridade/pseudonimo.js';

const CHAVE = new Uint8Array(randomBytes(32));

describe('pseudonimo', () => {
  it('é "Licitante #" + os 6 primeiros hex de HMAC-SHA256(chave, loteId:userId)', () => {
    const loteId = randomUUID();
    const userId = randomUUID();
    const esperado = createHmac('sha256', CHAVE).update(`${loteId}:${userId}`).digest('hex');

    expect(pseudonimo(CHAVE, loteId, userId)).toBe(`Licitante #${esperado.slice(0, 6)}`);
    expect(pseudonimo(CHAVE, loteId, userId)).toMatch(/^Licitante #[0-9a-f]{6}$/);
  });

  it('é estável dentro do lote', () => {
    const loteId = randomUUID();
    const userId = randomUUID();
    expect(pseudonimo(CHAVE, loteId, userId)).toBe(pseudonimo(CHAVE, loteId, userId));
  });

  it('muda entre lotes para o mesmo usuário', () => {
    const userId = randomUUID();
    const lotes = Array.from({ length: 20 }, () => randomUUID());
    const nomes = new Set(lotes.map((loteId) => pseudonimo(CHAVE, loteId, userId)));
    expect(nomes.size).toBeGreaterThan(1);
  });

  it('muda com a chave (usa os 32 bytes, não um texto fixo)', () => {
    const loteId = randomUUID();
    const userId = randomUUID();
    const outra = new Uint8Array(randomBytes(32));
    expect(pseudonimo(outra, loteId, userId)).not.toBe(pseudonimo(CHAVE, loteId, userId));
  });

  it.each([0, 31, 33])('recusa chave de %i bytes sem citar o conteúdo', (tamanho) => {
    expect(() => pseudonimo(new Uint8Array(tamanho), randomUUID(), randomUUID())).toThrow(
      /32 bytes/,
    );
  });
});
