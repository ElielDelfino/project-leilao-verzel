// Unidade: rate limit de janela fixa (specs/003 §Rate limit, ADR 0027 D8).
import { describe, expect, it } from 'vitest';

import { ErroApi } from '../../../src/common/erros/erro-api.js';
import {
  type ContadorDeJanela,
  JANELA_DO_LIMITE_S,
  LimiteDeTentativas,
  REGRA_DO_LANCE,
  TENTATIVAS_POR_JANELA,
} from '../../../src/common/limite/limite-de-tentativas.js';

/** Contador em memória: guarda as chaves pedidas e devolve contagem e TTL programados. */
function contadorFalso(ttlS = 37): ContadorDeJanela & { chaves: string[]; janelas: number[] } {
  const contagens = new Map<string, number>();
  const chaves: string[] = [];
  const janelas: number[] = [];
  return {
    chaves,
    janelas,
    incrementar: (chave, janelaS) => {
      chaves.push(chave);
      janelas.push(janelaS);
      const contagem = (contagens.get(chave) ?? 0) + 1;
      contagens.set(chave, contagem);
      return Promise.resolve({ contagem, ttlS });
    },
  };
}

async function erroDe(promessa: Promise<unknown>): Promise<ErroApi> {
  try {
    await promessa;
  } catch (erro) {
    if (erro instanceof ErroApi) {
      return erro;
    }
    throw erro;
  }
  throw new Error('deveria ter recusado');
}

describe('LimiteDeTentativas', () => {
  it('5 tentativas por janela de 60 s', () => {
    expect(TENTATIVAS_POR_JANELA).toBe(5);
    expect(JANELA_DO_LIMITE_S).toBe(60);
  });

  it('aceita 5 e recusa a 6ª com 429 MUITAS_TENTATIVAS e Retry-After = TTL', async () => {
    const limite = new LimiteDeTentativas(contadorFalso(37), 'ratelimit:');
    for (let i = 0; i < 5; i++) {
      await limite.consumir('cadastro:10.0.0.1');
    }

    const erro = await erroDe(limite.consumir('cadastro:10.0.0.1'));

    expect(erro.status).toBe(429);
    expect(erro.codigo).toBe('MUITAS_TENTATIVAS');
    expect(erro.retryAfterSegundos).toBe(37);
  });

  it.each([0, -1, -2])('Retry-After é no mínimo 1 (TTL %d)', async (ttl) => {
    const limite = new LimiteDeTentativas(contadorFalso(ttl), 'ratelimit:');
    for (let i = 0; i < 5; i++) {
      await limite.consumir('x');
    }

    expect((await erroDe(limite.consumir('x'))).retryAfterSegundos).toBe(1);
  });

  it('usa o prefixo injetado e a janela de 60 s', async () => {
    const contador = contadorFalso();
    const limite = new LimiteDeTentativas(contador, 'ratelimit:teste-abc:');

    await limite.consumir('login:10.0.0.1:0123456789abcdef');

    expect(contador.chaves).toEqual(['ratelimit:teste-abc:login:10.0.0.1:0123456789abcdef']);
    expect(contador.janelas).toEqual([60]);
  });

  it('falha do contador (Redis fora) é repassada, sem virar sucesso', async () => {
    const falha = new Error('redis fora');
    const limite = new LimiteDeTentativas(
      { incrementar: () => Promise.reject(falha) },
      'ratelimit:',
    );

    await expect(limite.consumir('x')).rejects.toBe(falha);
  });

  describe('regra parametrizada (ADR 0031 D6: lance, 10 por janela de 1 s)', () => {
    it('REGRA_DO_LANCE é limite 10 e janela de 1 s', () => {
      expect(REGRA_DO_LANCE).toEqual({ limite: 10, janelaS: 1 });
    });

    it('aceita 10 e recusa a 11ª com 429 MUITAS_TENTATIVAS e Retry-After 1', async () => {
      const contador = contadorFalso(1);
      const limite = new LimiteDeTentativas(contador, 'ratelimit:');
      for (let i = 0; i < 10; i++) {
        await limite.consumir('lance:u1', REGRA_DO_LANCE);
      }

      const erro = await erroDe(limite.consumir('lance:u1', REGRA_DO_LANCE));

      expect(erro.status).toBe(429);
      expect(erro.codigo).toBe('MUITAS_TENTATIVAS');
      expect(erro.retryAfterSegundos).toBe(1);
      expect(contador.janelas.every((janela) => janela === 1)).toBe(true);
    });

    it('sem regra, continua 5 em 60 s (login e cadastro não mudam)', async () => {
      const contador = contadorFalso();
      const limite = new LimiteDeTentativas(contador, 'ratelimit:');
      for (let i = 0; i < 5; i++) {
        await limite.consumir('login:x');
      }

      await expect(limite.consumir('login:x')).rejects.toBeInstanceOf(ErroApi);
      expect(contador.janelas[0]).toBe(60);
    });

    it.each([
      { limite: 0, janelaS: 1 },
      { limite: 10, janelaS: 0 },
      { limite: 1.5, janelaS: 1 },
    ])('recusa regra inválida %o sem tocar o contador', async (regra) => {
      const contador = contadorFalso();
      const limite = new LimiteDeTentativas(contador, 'ratelimit:');

      await expect(limite.consumir('x', regra)).rejects.toBeInstanceOf(RangeError);
      expect(contador.chaves).toEqual([]);
    });
  });

  it('recusa prefixo que não começa com ratelimit: (specs/013: reset só desse prefixo)', () => {
    expect(() => new LimiteDeTentativas(contadorFalso(), 'outro:')).toThrow(RangeError);
  });
});
