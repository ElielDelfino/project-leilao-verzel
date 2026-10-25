// Rate limit de janela fixa (specs/003 §Rate limit, ADR 0027 D8): 5 tentativas por chave em 60 s;
// a 6ª responde 429 MUITAS_TENTATIVAS com Retry-After = TTL restante (no mínimo 1).
import { HttpStatus } from '@nestjs/common';

import { ErroApi } from '../erros/erro-api.js';

export const TENTATIVAS_POR_JANELA = 5;
export const JANELA_DO_LIMITE_S = 60;

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
   * Conta a tentativa em `<prefixo><chave>`. A 6ª da janela lança 429 MUITAS_TENTATIVAS. Falha do
   * contador (Redis fora) é repassada: o filtro global responde 500 INDISPONIVEL (falha fechada).
   */
  async consumir(chave: string): Promise<void> {
    const { contagem, ttlS } = await this.#contador.incrementar(
      `${this.#prefixo}${chave}`,
      JANELA_DO_LIMITE_S,
    );
    if (contagem > TENTATIVAS_POR_JANELA) {
      throw new ErroApi({
        codigo: 'MUITAS_TENTATIVAS',
        status: HttpStatus.TOO_MANY_REQUESTS,
        mensagem: 'Muitas tentativas. Aguarde e tente novamente.',
        retryAfterSegundos: Math.max(RETRY_AFTER_MINIMO_S, ttlS),
      });
    }
  }
}
