// TRUNCATE nos testes de banco: pede ACCESS EXCLUSIVE antes de o trigger recusar, e escritas de
// outros arquivos nas mesmas tabelas travam (55P03) ou entram em deadlock (40P01) com ele. Este
// helper limita a espera de cada lock e repete a transação inteira, sem mascarar o resultado.
import { setTimeout as esperar } from 'node:timers/promises';

/** Menor que o `deadlock_timeout` padrão (1 s): o TRUNCATE desiste antes de virar causa de deadlock. */
export const LOCK_TIMEOUT_DO_TRUNCATE_MS = 500;
/** Pior caso de uma lista de 5 tabelas: 5 × 0,5 s × 3 tentativas + pausas ≈ 8 s, bem abaixo de 90 s. */
export const TENTATIVAS_DO_TRUNCATE = 3;
const PAUSA_BASE_MS = 100;
const JITTER_MS = 150;
const SQLSTATE_DE_DISPUTA_DE_LOCK = ['40P01', '55P03'];

/** `set local lock_timeout` para a transação de uma tentativa. */
export const COMANDO_LOCK_TIMEOUT = `set local lock_timeout = '${LOCK_TIMEOUT_DO_TRUNCATE_MS}ms'`;

/**
 * Chama `tentar` (que abre a própria transação, aplica `COMANDO_LOCK_TIMEOUT` e devolve o SQLSTATE
 * observado). Disputa de lock (40P01 ou 55P03) espera um tempo curto com jitter e repete; outro
 * código é devolvido para o teste comparar. Esgotadas as tentativas, lança um erro explícito.
 */
export async function repetirEmDisputaDeLock(
  descricao: string,
  tentar: () => Promise<string | undefined>,
): Promise<string | undefined> {
  let ultimo: string | undefined;
  for (let tentativa = 1; tentativa <= TENTATIVAS_DO_TRUNCATE; tentativa += 1) {
    ultimo = await tentar();
    if (ultimo === undefined || !SQLSTATE_DE_DISPUTA_DE_LOCK.includes(ultimo)) return ultimo;
    await esperar(PAUSA_BASE_MS + Math.floor(Math.random() * JITTER_MS));
  }
  throw new Error(
    `lock não liberado em ${TENTATIVAS_DO_TRUNCATE} tentativas (último SQLSTATE ${String(ultimo)}): ${descricao}`,
  );
}
