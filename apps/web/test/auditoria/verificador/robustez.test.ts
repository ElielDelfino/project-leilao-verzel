// Ed25519 estrito (zip215 desligado; mais estrito que o servidor), erros de ambiente e cadeia grande em blocos.
import { getPublicKeyAsync, signAsync } from '@noble/ed25519';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  type ChavePublicada,
  ErroDeContextoInseguro,
  keyIdDaChave,
  type LanceDaCadeia,
  verificarCadeia,
} from '../../../src/auditoria/verificador';
import {
  deHex,
  hashGenese,
  paraBase64Url,
  sha256DoTexto,
} from '../../../src/auditoria/verificador/canonico';
import { canonicoDoLance } from '../../../src/auditoria/verificador/hashes';

const LOTE = '0198f3c0-7b1a-7c00-8000-000000000001';
const SEED = deHex('9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60');
const INSTANTE_BASE = Date.parse('2026-10-27T14:00:00.000Z');

type Assinador = (hashHex: string) => Promise<string>;

async function montarCadeia(
  total: number,
  assinar: Assinador,
  keyId: string,
): Promise<LanceDaCadeia[]> {
  const lances: LanceDaCadeia[] = [];
  let anterior = await hashGenese(LOTE);
  for (let seq = 1; seq <= total; seq += 1) {
    const base = {
      seq,
      pseudonimo: 'Licitante #3fa9c1',
      valorCentavos: 1000 + seq * 100,
      criadoEm: new Date(INSTANTE_BASE + seq * 1000).toISOString(),
      hashAnterior: anterior,
    };
    const hash = await sha256DoTexto(
      canonicoDoLance(LOTE, { ...base, hash: '', assinatura: '', keyId }),
    );
    lances.push({ ...base, hash, assinatura: await assinar(hash), keyId });
    anterior = hash;
  }
  return lances;
}

async function chaveReal(): Promise<{ publica: ChavePublicada; assinar: Assinador }> {
  const publica = await getPublicKeyAsync(SEED);
  const keyId = await keyIdDaChave(publica);
  return {
    publica: { keyId, chavePublica: paraBase64Url(publica) },
    assinar: async (hashHex) => paraBase64Url(await signAsync(deHex(hashHex), SEED)),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Ed25519 estrito no navegador (zip215 desligado; o OpenSSL do servidor é mais permissivo)', () => {
  it('chave de ordem pequena (identidade) com assinatura trivial é rejeitada no navegador', async () => {
    // A = identidade (y=1), R = identidade, S = 0: o ZIP-215 aceitaria para qualquer mensagem.
    const identidade = new Uint8Array(32);
    identidade[0] = 1;
    const assinaturaTrivial = new Uint8Array(64);
    assinaturaTrivial[0] = 1;
    const keyId = await keyIdDaChave(identidade);
    const lances = await montarCadeia(2, async () => paraBase64Url(assinaturaTrivial), keyId);

    const resultado = await verificarCadeia({
      loteId: LOTE,
      lances,
      selo: null,
      chaves: [{ keyId, chavePublica: paraBase64Url(identidade) }],
    });

    if (resultado.tipo !== 'concluida') throw new Error('verificação pendente');
    expect(resultado.problemas.map((p) => `${p.codigo}:${p.seq}`)).toEqual([
      'ASSINATURA_INVALIDA:1',
      'ASSINATURA_INVALIDA:2',
    ]);
  });

  it('R com codificação não reduzida (y = p + 1) que o ZIP-215 aceitaria é rejeitado', async () => {
    // Medido com o noble nesta versão (mesmo par A, R, S, mensagem de 32 bytes):
    //   R = identidade canônica: zip215:true → aceita, zip215:false → rejeita
    //   R = y p+1 (não reduzido): zip215:true → aceita, zip215:false → rejeita
    // Com A = identidade a rejeição estrita pode vir da chave de ordem pequena ou do R não
    // reduzido; o teste prova só o resultado agregado (o ZIP-215 aceitaria, o modo estrito não).
    const identidade = new Uint8Array(32);
    identidade[0] = 1;
    const naoReduzida = new Uint8Array(64);
    // R = y p+1 em little-endian, S = 0: o ZIP-215 reduz y para 1 (identidade) e aceita.
    naoReduzida.fill(0xff, 1, 31);
    naoReduzida[0] = 0xee;
    naoReduzida[31] = 0x7f;
    const keyId = await keyIdDaChave(identidade);
    const lances = await montarCadeia(1, async () => paraBase64Url(naoReduzida), keyId);

    const resultado = await verificarCadeia({
      loteId: LOTE,
      lances,
      selo: null,
      chaves: [{ keyId, chavePublica: paraBase64Url(identidade) }],
    });

    if (resultado.tipo !== 'concluida') throw new Error('verificação pendente');
    expect(resultado.problemas.map((p) => `${p.codigo}:${p.seq}`)).toEqual([
      'ASSINATURA_INVALIDA:1',
    ]);
  });

  it('a assinatura legítima continua válida no modo estrito', async () => {
    const { publica, assinar } = await chaveReal();
    const lances = await montarCadeia(2, assinar, publica.keyId);

    const resultado = await verificarCadeia({
      loteId: LOTE,
      lances,
      selo: null,
      chaves: [publica],
    });

    if (resultado.tipo !== 'concluida') throw new Error('verificação pendente');
    expect(resultado.veredito).toBe('integro');
  });
});

describe('erro de ambiente na assinatura', () => {
  it('falha do WebCrypto durante a verificação sobe, sem virar ASSINATURA_INVALIDA', async () => {
    const { publica, assinar } = await chaveReal();
    const lances = await montarCadeia(1, assinar, publica.keyId);
    const real = globalThis.crypto.subtle;
    // SHA-256 (canônico) funciona; SHA-512 (usado pelo Ed25519) quebra.
    vi.stubGlobal('crypto', {
      subtle: {
        digest: (algoritmo: string, dados: BufferSource) => {
          if (algoritmo === 'SHA-256') return real.digest(algoritmo, dados);
          return Promise.reject(new Error('webcrypto quebrou'));
        },
      },
    });

    await expect(
      verificarCadeia({ loteId: LOTE, lances, selo: null, chaves: [publica] }),
    ).rejects.toThrow('webcrypto quebrou');
  });

  it('sem crypto.subtle o caminho da assinatura lança ErroDeContextoInseguro', async () => {
    const { publica, assinar } = await chaveReal();
    const lances = await montarCadeia(1, assinar, publica.keyId);
    const real = globalThis.crypto.subtle;
    // O subtle some depois do primeiro SHA-256 do lance (o hash canônico do lance 1).
    let desligado = false;
    vi.stubGlobal('crypto', {
      get subtle() {
        if (desligado) return undefined;
        return {
          digest: async (algoritmo: string, dados: BufferSource) => {
            const resultado = await real.digest(algoritmo, dados);
            if (dados.byteLength > 32) desligado = true;
            return resultado;
          },
        };
      },
    });

    await expect(
      verificarCadeia({ loteId: LOTE, lances, selo: null, chaves: [publica] }),
    ).rejects.toBeInstanceOf(ErroDeContextoInseguro);
  });
});

describe('cadeia grande, em blocos', () => {
  it('300 lances verificam íntegros', async () => {
    const { publica, assinar } = await chaveReal();
    const lances = await montarCadeia(300, assinar, publica.keyId);

    const resultado = await verificarCadeia({
      loteId: LOTE,
      lances,
      selo: null,
      chaves: [publica],
    });

    if (resultado.tipo !== 'concluida') throw new Error('verificação pendente');
    expect(resultado.veredito).toBe('integro');
    expect(resultado.problemas).toEqual([]);
  });

  it('adulterações em blocos diferentes saem na ordem da cadeia', async () => {
    const { publica, assinar } = await chaveReal();
    const lances = await montarCadeia(120, assinar, publica.keyId);
    const adulterados = lances.map((l) =>
      l.seq === 10 || l.seq === 75 ? { ...l, valorCentavos: 1 } : l,
    );

    const resultado = await verificarCadeia({
      loteId: LOTE,
      lances: adulterados,
      selo: null,
      chaves: [publica],
    });

    if (resultado.tipo !== 'concluida') throw new Error('verificação pendente');
    expect(resultado.problemas.map((p) => `${p.codigo}:${p.seq}`)).toEqual([
      'HASH_DIVERGENTE:10',
      'HASH_DIVERGENTE:75',
    ]);
  });
});
