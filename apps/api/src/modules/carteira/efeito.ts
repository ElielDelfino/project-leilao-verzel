// Efeito de cada tipo de lançamento na projeção wallet_balances (specs/004 §Comportamento,
// tabela). Funções puras, em centavos inteiros (ADR 0001): nada de float.
import { tipoLancamento } from '../../db/schema.js';

export const TIPOS_DE_LANCAMENTO = tipoLancamento.enumValues;
export type TipoDeLancamento = (typeof TIPOS_DE_LANCAMENTO)[number];

/** Variação (com sinal) que um lançamento causa em total e comprometido. */
export interface Efeito {
  readonly total: number;
  readonly comprometido: number;
}

/** Saldo da projeção, em centavos. */
export interface SaldoEmCentavos {
  readonly total: number;
  readonly comprometido: number;
}

/** Sinal do efeito de cada tipo em [total, comprometido]. */
const SINAIS: Readonly<Record<TipoDeLancamento, readonly [number, number]>> = {
  deposito: [1, 0],
  compromisso: [0, 1],
  liberacao: [0, -1],
  estorno: [0, -1],
  debito_arremate: [-1, -1],
  credito_arremate: [1, 0],
};

/** `valor` precisa ser inteiro positivo e seguro (≤ 2^53 − 1), como o CHECK de ledger_entries. */
export function efeitoDoLancamento(tipo: TipoDeLancamento, valor: number): Efeito {
  if (!Number.isSafeInteger(valor) || valor <= 0) {
    throw new RangeError('valor do lançamento precisa ser inteiro positivo seguro');
  }
  const [sinalDoTotal, sinalDoComprometido] = SINAIS[tipo];
  // `+ 0` normaliza o -0 de `0 * -v`.
  return { total: sinalDoTotal * valor + 0, comprometido: sinalDoComprometido * valor + 0 };
}

/** Novo saldo com o efeito aplicado; o original não é alterado. */
export function aplicarEfeito(saldo: SaldoEmCentavos, efeito: Efeito): SaldoEmCentavos {
  return {
    total: saldo.total + efeito.total,
    comprometido: saldo.comprometido + efeito.comprometido,
  };
}

const INTEIRO_DECIMAL = /^(0|[1-9]\d*)$/;

/**
 * Converte um inteiro não negativo vindo do banco (bigint do pg chega como string) em `number`,
 * conferindo Number.MAX_SAFE_INTEGER antes: acima disso a conversão perderia precisão em silêncio.
 */
export function inteiroSeguro(valor: unknown): number {
  let grande: bigint | undefined;
  if (typeof valor === 'bigint') {
    grande = valor;
  } else if (typeof valor === 'string' && INTEIRO_DECIMAL.test(valor)) {
    grande = BigInt(valor);
  } else if (typeof valor === 'number' && Number.isSafeInteger(valor)) {
    grande = BigInt(valor);
  }
  if (grande === undefined || grande < 0n || grande > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('valor do banco não é um inteiro não negativo seguro');
  }
  return Number(grande);
}
