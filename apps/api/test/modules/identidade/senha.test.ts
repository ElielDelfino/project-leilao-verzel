// Unidade: hash de senha argon2id em PHC (specs/003 RNF-01 e §Dados; ADR 0027).
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ErroDoHashDeSenha,
  gerarHashDeSenha,
  PARAMETROS_DO_ARGON2,
  verificarSenha,
} from '../../../src/modules/identidade/senha.js';

/** Formato exigido pelo critério de aceite de specs/003 (sal e hash em base64 sem padding). */
const FORMATO_PHC = /^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('gerarHashDeSenha', () => {
  it('grava a string PHC do argon2id com os parâmetros do RNF-01', async () => {
    const phc = await gerarHashDeSenha('senha-correta-123');

    expect(phc).toMatch(FORMATO_PHC);
  });

  it('sal de 16 bytes e hash de 32 bytes', async () => {
    const phc = await gerarHashDeSenha('senha-correta-123');

    const [, , , , sal, hash] = phc.split('$');
    expect(Buffer.from(sal ?? '', 'base64')).toHaveLength(16);
    expect(Buffer.from(hash ?? '', 'base64')).toHaveLength(32);
  });

  it('a mesma senha gera hashes diferentes (sal aleatório)', async () => {
    const [a, b] = await Promise.all([
      gerarHashDeSenha('mesma-senha-123'),
      gerarHashDeSenha('mesma-senha-123'),
    ]);

    expect(a).not.toBe(b);
  });

  it('não contém a senha', async () => {
    const senha = 'senha-que-nao-aparece';

    expect(await gerarHashDeSenha(senha)).not.toContain(senha);
  });
});

describe('verificarSenha', () => {
  it('aceita a senha certa e recusa a errada, só com o que está na string', async () => {
    const phc = await gerarHashDeSenha('senha-correta-123');

    expect(await verificarSenha('senha-correta-123', phc)).toBe(true);
    expect(await verificarSenha('senha-errada-1234', phc)).toBe(false);
  });

  it('aceita senha com caracteres fora do ASCII', async () => {
    const phc = await gerarHashDeSenha('ção-ñ-😀-123456');

    expect(await verificarSenha('ção-ñ-😀-123456', phc)).toBe(true);
    expect(await verificarSenha('cao-n-😀-123456', phc)).toBe(false);
  });

  it('hash adulterado não confere', async () => {
    const phc = await gerarHashDeSenha('senha-correta-123');
    const partes = phc.split('$');
    const hash = Buffer.from(partes[5] ?? '', 'base64');
    hash[0] = (hash[0] ?? 0) ^ 0xff;
    const adulterado = [...partes.slice(0, 5), hash.toString('base64').replace(/=+$/, '')].join(
      '$',
    );

    expect(await verificarSenha('senha-correta-123', adulterado)).toBe(false);
  });

  it.each([
    ['vazia', ''],
    ['outro algoritmo', '$argon2i$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNo'],
    ['outra versão', '$argon2id$v=16$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNo'],
    ['sem hash', '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0'],
    ['com padding', '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA==$aGFzaGhhc2hoYXNo'],
    ['sal curto', '$argon2id$v=19$m=19456,t=2,p=1$c2Fs$aGFzaGhhc2hoYXNo'],
    // Teto de custo: uma linha corrompida não pode alocar gigabytes nem prender a thread.
    ['memória acima do teto', '$argon2id$v=19$m=9999999999,t=2,p=1$c2FsdHNhbHRzYWx0$aGFzaGhhc2g'],
    ['passadas acima do teto', '$argon2id$v=19$m=19456,t=99,p=1$c2FsdHNhbHRzYWx0$aGFzaGhhc2g'],
    ['paralelismo acima do teto', '$argon2id$v=19$m=19456,t=2,p=64$c2FsdHNhbHRzYWx0$aGFzaGhhc2g'],
  ])('string PHC malformada (%s) lança ErroDoHashDeSenha sem citar a string', async (_, phc) => {
    const verificacao = verificarSenha('qualquer-senha', phc);

    await expect(verificacao).rejects.toBeInstanceOf(ErroDoHashDeSenha);
    await verificacao.catch((erro: unknown) => {
      if (phc !== '') {
        expect(String(erro)).not.toContain(phc);
      }
    });
  });
});

// specs/003 §Critérios (RNF-01): toda chamada a crypto.argon2 usa argon2id, memory 19456,
// passes 2 e parallelism 1, no hash e na verificação; a API não depende do pacote `argon2`.
describe('RNF-01: parâmetros de toda chamada a crypto.argon2', () => {
  it('o hash e a verificação chamam crypto.argon2 com argon2id e os parâmetros OWASP', async () => {
    const espiao = vi.spyOn(crypto, 'argon2');

    const phc = await gerarHashDeSenha('senha-correta-123');
    await verificarSenha('senha-correta-123', phc);
    await verificarSenha('senha-errada-1234', phc);

    expect(espiao).toHaveBeenCalledTimes(3);
    for (const [algoritmo, parametros] of espiao.mock.calls) {
      expect(algoritmo).toBe('argon2id');
      expect(parametros).toMatchObject({
        memory: 19456,
        passes: 2,
        parallelism: 1,
        tagLength: 32,
      });
      expect(Buffer.from(parametros.nonce as Uint8Array)).toHaveLength(16);
    }
  });

  it('os parâmetros exportados são os do RNF-01', () => {
    expect(PARAMETROS_DO_ARGON2).toEqual({ memory: 19456, passes: 2, parallelism: 1 });
  });

  it('a API não depende do pacote argon2 (ADR 0027)', () => {
    const pacote = JSON.parse(
      readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'),
    ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };

    expect(pacote.dependencies).not.toHaveProperty('argon2');
    expect(pacote.devDependencies).not.toHaveProperty('argon2');
  });
});
