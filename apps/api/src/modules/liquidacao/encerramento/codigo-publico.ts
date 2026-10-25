// Código público do comprovante (specs/010 §Dados, specs/011): 16 caracteres base62, ~95 bits.
// Bytes de `crypto.randomBytes` com amostragem por rejeição: só vale o byte < 248 (4 × 62), e o
// caractere é `byte % 62`; os demais são descartados e sorteados de novo. Sem viés de módulo e
// nunca `Math.random`, hora ou contador.
import { randomBytes } from 'node:crypto';

export const ALFABETO_DO_CODIGO = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export const TAMANHO_DO_CODIGO = 16;

/** Maior múltiplo de 62 que cabe num byte: bytes a partir daqui criariam viés. */
const LIMITE_SEM_VIES = Math.floor(256 / ALFABETO_DO_CODIGO.length) * ALFABETO_DO_CODIGO.length;

/** Fonte de bytes aleatórios; trocada só nos testes. */
export type SorteioDeBytes = (quantidade: number) => Buffer;

export function gerarCodigoPublico(sortear: SorteioDeBytes = randomBytes): string {
  let codigo = '';
  while (codigo.length < TAMANHO_DO_CODIGO) {
    const faltam = TAMANHO_DO_CODIGO - codigo.length;
    const bytes = sortear(faltam);
    if (bytes.length === 0) throw new Error('a fonte de bytes aleatórios não devolveu bytes');
    for (const byte of bytes.subarray(0, faltam)) {
      if (byte < LIMITE_SEM_VIES)
        codigo += ALFABETO_DO_CODIGO.charAt(byte % ALFABETO_DO_CODIGO.length);
    }
  }
  return codigo;
}
