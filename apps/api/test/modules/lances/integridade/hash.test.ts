// Unidade: gênese, canônico e hash do lance e do selo, com o vetor da specs/008 §Forma canônica e vetor de teste.
import { describe, expect, it } from 'vitest';

import {
  assinar,
  derivarChaves,
  verificar,
} from '../../../../src/modules/lances/integridade/assinatura.js';
import { ErroDeCanonico } from '../../../../src/modules/lances/integridade/canonico.js';
import {
  canonicoDoLance,
  canonicoDoSelo,
  type DadosDoLance,
  type DadosDoSelo,
  hashDoLance,
  hashDoSelo,
  hashGenese,
} from '../../../../src/modules/lances/integridade/hash.js';

// Vetor público do RFC 8032 §7.1 TEST 1 (não é chave de nenhum ambiente).
const SEED_RFC8032_TEST1 = new Uint8Array(
  Buffer.from('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60', 'hex'),
);
const LOTE = '0198f3c0-7b1a-7c00-8000-000000000001';
const GENESE = '82842ba46c36a8e7ea4d91bab2695ec3281f83824f6b9c91af66cbaef0423585';
const HASH_1 = 'af1bac38780142da599db0996414d71a5a5b98ad198b2c0c8f7a1bf55abdd8cb';
const HASH_2 = '70110ba5cbdcbd8f62e443939427c9182717a6273e4b5b2bea997034a5427e93';

const LANCE_1: DadosDoLance = {
  loteId: LOTE,
  seq: 1,
  pseudonimo: 'Licitante #3fa9c1',
  valorCentavos: 15000,
  criadoEm: '2026-10-27T14:03:07.120Z',
  hashAnterior: GENESE,
};
const LANCE_2: DadosDoLance = {
  loteId: LOTE,
  seq: 2,
  pseudonimo: 'Licitante #b04e7d',
  valorCentavos: 16500,
  criadoEm: '2026-10-27T14:03:41.907Z',
  hashAnterior: HASH_1,
};

describe('vetor de teste da specs/008', () => {
  const { chavePrivada, chavePublica } = derivarChaves(SEED_RFC8032_TEST1);

  it('reproduz o hash da gênese', () => {
    expect(hashGenese(LOTE)).toBe(GENESE);
  });

  it('reproduz canônico, hash e assinatura do lance 1', () => {
    expect(canonicoDoLance(LANCE_1)).toBe(
      '{"criadoEm":"2026-10-27T14:03:07.120Z","hashAnterior":"82842ba46c36a8e7ea4d91bab2695ec3281f83824f6b9c91af66cbaef0423585","loteId":"0198f3c0-7b1a-7c00-8000-000000000001","pseudonimo":"Licitante #3fa9c1","seq":1,"valorCentavos":15000}',
    );
    expect(hashDoLance(LANCE_1)).toBe(HASH_1);
    const assinatura = assinar(chavePrivada, HASH_1);
    expect(assinatura).toBe(
      'MOumYMXLSRf1yq3BzD9MT4kPV0kMPUFw4cUEvbCd-u90psSijUKdOoE4nO9hy__a9mAzFP3ygg-RNp5DNRDyDQ',
    );
    expect(verificar(chavePublica, HASH_1, assinatura)).toBe(true);
  });

  it('reproduz canônico, hash e assinatura do lance 2', () => {
    expect(canonicoDoLance(LANCE_2)).toBe(
      '{"criadoEm":"2026-10-27T14:03:41.907Z","hashAnterior":"af1bac38780142da599db0996414d71a5a5b98ad198b2c0c8f7a1bf55abdd8cb","loteId":"0198f3c0-7b1a-7c00-8000-000000000001","pseudonimo":"Licitante #b04e7d","seq":2,"valorCentavos":16500}',
    );
    expect(hashDoLance(LANCE_2)).toBe(HASH_2);
    const assinatura = assinar(chavePrivada, HASH_2);
    expect(assinatura).toBe(
      'RK6Z6YI2HbG7BDQuSctvl2AXor2Bxwyw5m-BPPTSK_bVMhNBUw9rSqJuFYrbltWJOQaZ-tMGB9U3QzvtFfiDAA',
    );
    expect(verificar(chavePublica, HASH_2, assinatura)).toBe(true);
  });
});

describe('canonicoDoLance', () => {
  it('ignora campos extras do objeto (só as 6 chaves da specs/008 entram)', () => {
    const comExtras = { ...LANCE_1, hash: HASH_1, assinatura: 'x', keyId: 'y' } as DadosDoLance;
    expect(canonicoDoLance(comExtras)).toBe(canonicoDoLance(LANCE_1));
  });

  it.each<[string, Partial<DadosDoLance>]>([
    ['loteId em maiúsculas', { loteId: LOTE.toUpperCase() }],
    ['loteId que não é UUID', { loteId: 'lote-1' }],
    ['hashAnterior em maiúsculas', { hashAnterior: GENESE.toUpperCase() }],
    ['hashAnterior curto', { hashAnterior: GENESE.slice(1) }],
    ['criadoEm sem milissegundos', { criadoEm: '2026-10-27T14:03:07Z' }],
    ['criadoEm com 6 casas', { criadoEm: '2026-10-27T14:03:07.120000Z' }],
    ['criadoEm com fuso', { criadoEm: '2026-10-27T11:03:07.120-03:00' }],
    ['seq zero', { seq: 0 }],
    ['seq fracionária', { seq: 1.5 }],
    ['valor fracionário', { valorCentavos: 150.5 }],
    ['valor acima de 2^53 - 1', { valorCentavos: 2 ** 53 }],
    ['pseudônimo não ASCII', { pseudonimo: 'Licitante #3fa9c€' }],
  ])('recusa %s', (_nome, mudanca) => {
    expect(() => canonicoDoLance({ ...LANCE_1, ...mudanca })).toThrow(ErroDeCanonico);
  });

  it('qualquer campo alterado muda o hash', () => {
    const variantes: DadosDoLance[] = [
      { ...LANCE_1, loteId: '0198f3c0-7b1a-7c00-8000-000000000002' },
      { ...LANCE_1, seq: 2 },
      { ...LANCE_1, pseudonimo: 'Licitante #3fa9c2' },
      { ...LANCE_1, valorCentavos: 15001 },
      { ...LANCE_1, criadoEm: '2026-10-27T14:03:07.121Z' },
      { ...LANCE_1, hashAnterior: HASH_2 },
    ];
    for (const variante of variantes) {
      expect(hashDoLance(variante)).not.toBe(HASH_1);
    }
  });
});

describe('hashGenese', () => {
  it('depende do lote', () => {
    expect(hashGenese('0198f3c0-7b1a-7c00-8000-000000000002')).not.toBe(GENESE);
  });

  it('recusa loteId fora do formato UUID minúsculo', () => {
    expect(() => hashGenese(LOTE.toUpperCase())).toThrow(ErroDeCanonico);
  });
});

describe('canonicoDoSelo e hashDoSelo', () => {
  const SELO_ENCERRADO: DadosDoSelo = {
    loteId: LOTE,
    status: 'encerrado',
    totalLances: 2,
    hashFinal: HASH_2,
    vencedorPseudonimo: 'Licitante #b04e7d',
    valorArremateCentavos: 16500,
    seladoEm: '2026-10-27T15:00:00.004Z',
  };

  it('usa as 7 chaves da specs/008 em ordem alfabética', () => {
    expect(canonicoDoSelo(SELO_ENCERRADO)).toBe(
      `{"hashFinal":"${HASH_2}","loteId":"${LOTE}","seladoEm":"2026-10-27T15:00:00.004Z","status":"encerrado","totalLances":2,"valorArremateCentavos":16500,"vencedorPseudonimo":"Licitante #b04e7d"}`,
    );
    expect(hashDoSelo(SELO_ENCERRADO)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('mantém as chaves com null em lote cancelado sem lance', () => {
    const cancelado: DadosDoSelo = {
      loteId: LOTE,
      status: 'cancelado',
      totalLances: 0,
      hashFinal: GENESE,
      vencedorPseudonimo: null,
      valorArremateCentavos: null,
      seladoEm: '2026-10-27T15:00:00.004Z',
    };
    expect(canonicoDoSelo(cancelado)).toBe(
      `{"hashFinal":"${GENESE}","loteId":"${LOTE}","seladoEm":"2026-10-27T15:00:00.004Z","status":"cancelado","totalLances":0,"valorArremateCentavos":null,"vencedorPseudonimo":null}`,
    );
  });

  it.each<[string, Partial<DadosDoSelo>]>([
    ['status desconhecido', { status: 'aberto' as DadosDoSelo['status'] }],
    ['totalLances negativo', { totalLances: -1 }],
    ['hashFinal curto', { hashFinal: HASH_2.slice(1) }],
    ['seladoEm sem milissegundos', { seladoEm: '2026-10-27T15:00:00Z' }],
    ['valor fracionário', { valorArremateCentavos: 1.5 }],
  ])('recusa %s', (_nome, mudanca) => {
    expect(() => canonicoDoSelo({ ...SELO_ENCERRADO, ...mudanca })).toThrow(ErroDeCanonico);
  });

  it('qualquer campo alterado muda o hash do selo', () => {
    const original = hashDoSelo(SELO_ENCERRADO);
    const variantes: DadosDoSelo[] = [
      { ...SELO_ENCERRADO, loteId: '0198f3c0-7b1a-7c00-8000-000000000002' },
      { ...SELO_ENCERRADO, status: 'cancelado' },
      { ...SELO_ENCERRADO, totalLances: 1 },
      { ...SELO_ENCERRADO, hashFinal: HASH_1 },
      { ...SELO_ENCERRADO, vencedorPseudonimo: null },
      { ...SELO_ENCERRADO, valorArremateCentavos: 16501 },
      { ...SELO_ENCERRADO, seladoEm: '2026-10-27T15:00:00.005Z' },
    ];
    for (const variante of variantes) {
      expect(hashDoSelo(variante)).not.toBe(original);
    }
  });
});
