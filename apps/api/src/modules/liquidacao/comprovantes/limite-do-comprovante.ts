// Rate limit do comprovante público (specs/011 §Rate limit). Regime atual, até a tarefa 020
// (`trustProxy`, F5): só o teto global de 600 por minuto, sem limite fino por IP. Falha ABERTA:
// com o Redis fora a requisição passa, com aviso no log (o comprovante é público e só lê).
import type {
  LimiteDeTentativas,
  RegraDoLimite,
} from '../../../common/limite/limite-de-tentativas.js';
import { ErroApi } from '../../../common/erros/erro-api.js';

export const CHAVE_DO_LIMITE_DO_COMPROVANTE = 'comprovante:global';

export const REGRA_DO_COMPROVANTE: RegraDoLimite = Object.freeze({ limite: 600, janelaS: 60 });

/** Conta a requisição; 429 sobe; qualquer outra falha do contador é registrada e ignorada. */
export async function consumirLimiteDoComprovante(
  limite: LimiteDeTentativas,
  avisar: (mensagem: string) => void,
): Promise<void> {
  try {
    await limite.consumir(CHAVE_DO_LIMITE_DO_COMPROVANTE, REGRA_DO_COMPROVANTE);
  } catch (erro: unknown) {
    if (erro instanceof ErroApi) throw erro;
    avisar('contador do rate limit do comprovante indisponível; requisição liberada');
  }
}
