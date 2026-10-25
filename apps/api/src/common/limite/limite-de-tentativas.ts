// Rate limit de janela fixa (specs/003 §Rate limit, ADR 0027 D8): por padrão 5 tentativas por
// chave em 60 s; a 6ª responde 429 MUITAS_TENTATIVAS com Retry-After = TTL restante (no mínimo 1).
// Limite e janela também vêm por parâmetro (ADR 0031 D6): o lance usa 10 por janela de 1 s.
import { HttpStatus } from '@nestjs/common';

import { ErroApi } from '../erros/erro-api.js';

export const TENTATIVAS_POR_JANELA = 5;
export const JANELA_DO_LIMITE_S = 60;

/** Tentativas aceitas (`limite`) por janela fixa de `janelaS` segundos, ambos inteiros ≥ 1. */
export interface RegraDoLimite {
  readonly limite: number;
  readonly janelaS: number;
}

/** Login e cadastro (specs/003 §Rate limit). */
export const REGRA_PADRAO: RegraDoLimite = Object.freeze({
  limite: TENTATIVAS_POR_JANELA,
  janelaS: JANELA_DO_LIMITE_S,
});

/** Lance: 10 por segundo por usuário (specs/007 RNF-02, ADR 0031 D6). */
export const REGRA_DO_LANCE: RegraDoLimite = Object.freeze({ limite: 10, janelaS: 1 });

function validarRegra({ limite, janelaS }: RegraDoLimite): void {
  if (
    !Number.isSafeInteger(limite) ||
    limite < 1 ||
    !Number.isSafeInteger(janelaS) ||
    janelaS < 1
  ) {
    throw new RangeError('regra do rate limit: limite e janela precisam ser inteiros ≥ 1');
  }
}

/** Prefixo de produção; os testes injetam um prefixo próprio abaixo dele. */
export const PREFIXO_PADRAO_DO_LIMITE = 'ratelimit:';

const RETRY_AFTER_MINIMO_S = 1;

export interface ContagemDaJanela {
  /** Tentativas na janela, já contando esta. */
  readonly contagem: number;
  /** Segundos até a janela acabar (TTL da chave). */
  readonly ttlS: number;
}

/** INCR + EXPIRE NX atômicos (implementação Redis em contador-redis.ts). */
export interface ContadorDeJanela {
  incrementar(chave: string, janelaS: number): Promise<ContagemDaJanela>;
}

export class LimiteDeTentativas {
  readonly #contador: ContadorDeJanela;
  readonly #prefixo: string;

  constructor(contador: ContadorDeJanela, prefixo: string) {
    if (!prefixo.startsWith(PREFIXO_PADRAO_DO_LIMITE)) {
      throw new RangeError(
        `o prefixo do rate limit precisa começar com ${PREFIXO_PADRAO_DO_LIMITE}`,
      );
    }
    this.#contador = contador;
    this.#prefixo = prefixo;
  }

  /**
   * Conta a tentativa em `<prefixo><chave>`. Passar de `regra.limite` na janela lança 429
   * MUITAS_TENTATIVAS. Falha do contador (Redis fora) é repassada: o filtro global responde 500
   * INDISPONIVEL (falha fechada). Regra inválida lança RangeError sem tocar o contador.
   */
  async consumir(chave: string, regra: RegraDoLimite = REGRA_PADRAO): Promise<void> {
    validarRegra(regra);
    const { contagem, ttlS } = await this.#contador.incrementar(
      `${this.#prefixo}${chave}`,
      regra.janelaS,
    );
    if (contagem > regra.limite) {
      throw new ErroApi({
        codigo: 'MUITAS_TENTATIVAS',
        status: HttpStatus.TOO_MANY_REQUESTS,
        mensagem: 'Muitas tentativas. Aguarde e tente novamente.',
        retryAfterSegundos: Math.max(RETRY_AFTER_MINIMO_S, ttlS),
      });
    }
  }
}
