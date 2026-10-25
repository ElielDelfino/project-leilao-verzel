// Vetor de specs/008 §Forma canônica e vetor de teste e §Chaves (RFC 8032 §7.1 TEST 1, RFC 8785).
import { getPublicKeyAsync, verifyAsync } from '@noble/ed25519';
import { describe, expect, it } from 'vitest';

import {
  canonicalizar,
  deBase64Url,
  deHex,
  ErroDeCanonico,
  hashGenese,
  keyIdDaChave,
  paraBase64Url,
  paraHex,
  sha256DoTexto,
} from '../../../src/auditoria/verificador/canonico';
import { canonicoDoLance } from '../../../src/auditoria/verificador/hashes';
import type { LanceDaCadeia } from '../../../src/auditoria/verificador/tipos';

const LOTE = '0198f3c0-7b1a-7c00-8000-000000000001';
const SEED_HEX = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';
const CHAVE_PUBLICA = '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo';
const GENESE = '82842ba46c36a8e7ea4d91bab2695ec3281f83824f6b9c91af66cbaef0423585';

const LANCE_1: LanceDaCadeia = {
  seq: 1,
  pseudonimo: 'Licitante #3fa9c1',
  valorCentavos: 15000,
  criadoEm: '2026-10-27T14:03:07.120Z',
  hashAnterior: GENESE,
  hash: 'af1bac38780142da599db0996414d71a5a5b98ad198b2c0c8f7a1bf55abdd8cb',
  assinatura:
    'MOumYMXLSRf1yq3BzD9MT4kPV0kMPUFw4cUEvbCd-u90psSijUKdOoE4nO9hy__a9mAzFP3ygg-RNp5DNRDyDQ',
  keyId: '21fe31dfa154a261',
};
const LANCE_2: LanceDaCadeia = {
  seq: 2,
  pseudonimo: 'Licitante #b04e7d',
  valorCentavos: 16500,
  criadoEm: '2026-10-27T14:03:41.907Z',
  hashAnterior: LANCE_1.hash,
  hash: '70110ba5cbdcbd8f62e443939427c9182717a6273e4b5b2bea997034a5427e93',
  assinatura:
    'RK6Z6YI2HbG7BDQuSctvl2AXor2Bxwyw5m-BPPTSK_bVMhNBUw9rSqJuFYrbltWJOQaZ-tMGB9U3QzvtFfiDAA',
  keyId: '21fe31dfa154a261',
};

const CANONICO_1 =
  '{"criadoEm":"2026-10-27T14:03:07.120Z","hashAnterior":"82842ba46c36a8e7ea4d91bab2695ec3281f83824f6b9c91af66cbaef0423585","loteId":"0198f3c0-7b1a-7c00-8000-000000000001","pseudonimo":"Licitante #3fa9c1","seq":1,"valorCentavos":15000}';
const CANONICO_2 =
  '{"criadoEm":"2026-10-27T14:03:41.907Z","hashAnterior":"af1bac38780142da599db0996414d71a5a5b98ad198b2c0c8f7a1bf55abdd8cb","loteId":"0198f3c0-7b1a-7c00-8000-000000000001","pseudonimo":"Licitante #b04e7d","seq":2,"valorCentavos":16500}';

describe('chave do vetor (RFC 8032 TEST 1)', () => {
  it('deriva a chave pública e o keyId da seed', async () => {
    const publica = await getPublicKeyAsync(deHexLivre(SEED_HEX));

    expect(paraBase64Url(publica)).toBe(CHAVE_PUBLICA);
    expect(await keyIdDaChave(publica)).toBe('21fe31dfa154a261');
  });
});

describe.each([
  ['lance 1', LANCE_1, CANONICO_1],
  ['lance 2', LANCE_2, CANONICO_2],
])('vetor da spec: %s', (_nome, lance, canonicoEsperado) => {
  it('reproduz o canônico e o hash', async () => {
    const canonico = canonicoDoLance(LOTE, lance);

    expect(canonico).toBe(canonicoEsperado);
    expect(await sha256DoTexto(canonico)).toBe(lance.hash);
  });

  it('valida a assinatura sobre os 32 bytes do hash', async () => {
    const assinatura = deBase64Url(lance.assinatura);
    const publica = deBase64Url(CHAVE_PUBLICA);

    if (assinatura === null || publica === null) throw new Error('base64url inválido');
    expect(await verifyAsync(assinatura, deHex(lance.hash), publica)).toBe(true);
  });
});

it('a gênese do lote é SHA-256 de "leilao-verzel:genesis:" + loteId', async () => {
  expect(await hashGenese(LOTE)).toBe(GENESE);
});

describe('canonicalizar (subconjunto da RFC 8785)', () => {
  it('ordena as chaves, sem espaços, com inteiros e null', () => {
    expect(canonicalizar({ b: 2, a: 'x', c: null })).toBe('{"a":"x","b":2,"c":null}');
  });

  it('ordena chaves numéricas como texto, não como o JS ordenaria o objeto', () => {
    expect(canonicalizar({ b: 1, '10': 2, '2': 3 })).toBe('{"10":2,"2":3,"b":1}');
  });

  it('escapa aspas e barras como o JSON', () => {
    expect(canonicalizar({ a: 'x"y\\z' })).toBe('{"a":"x\\"y\\\\z"}');
  });

  it.each([
    ['string fora do ASCII', { a: 'ação' }],
    ['número não inteiro', { a: 1.5 }],
    ['inteiro inseguro', { a: 2 ** 53 }],
  ])('recusa %s', (_nome, objeto) => {
    expect(() => canonicalizar(objeto)).toThrow(ErroDeCanonico);
  });
});

describe('base64url e hex', () => {
  it('só aceita base64url na forma canônica', () => {
    expect(deBase64Url(CHAVE_PUBLICA)?.length).toBe(32);
    expect(deBase64Url('AA==')).toBeNull();
    expect(deBase64Url('+/+/')).toBeNull();
    // Último caractere com bits de sobra: recodificar não reproduz o texto.
    expect(deBase64Url('AB')).toBeNull();
  });

  it('ida e volta do hex', () => {
    expect(paraHex(deHex(GENESE))).toBe(GENESE);
  });
});

function deHexLivre(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../g) ?? [], (par) => Number.parseInt(par, 16));
}
