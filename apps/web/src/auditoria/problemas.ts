import type { CodigoDoProblema } from './verificador';

// Textos de specs/012 §Auditoria. A descrição vem do código, nunca do campo `mensagem` do servidor.
const DESCRICOES: Readonly<Record<CodigoDoProblema, string>> = {
  SEQ_FORA_DE_ORDEM: 'sequência fora de ordem',
  HASH_ANTERIOR_DIVERGENTE: 'hash anterior não confere',
  HASH_DIVERGENTE: 'hash não confere',
  ASSINATURA_INVALIDA: 'assinatura inválida',
  CHAVE_DESCONHECIDA: 'chave de assinatura desconhecida',
  SELO_TOTAL_DIVERGENTE: 'total de lances não confere com o selo',
  SELO_HASH_FINAL_DIVERGENTE: 'hash final não confere com o selo',
  SELO_ASSINATURA_INVALIDA: 'assinatura do selo inválida',
};

export interface ProblemaExibido {
  readonly codigo: CodigoDoProblema;
  readonly seq: number | null;
}

/** "lance #4: hash não confere" ou, nos problemas do selo (`seq` nulo), "selo: …". */
export function textoDoProblema({ codigo, seq }: ProblemaExibido): string {
  const descricao = DESCRICOES[codigo] ?? 'problema desconhecido';
  return `${seq === null ? 'selo' : `lance #${seq}`}: ${descricao}`;
}

export function textoDeContagem(total: number): string {
  return total === 1 ? '1 problema' : `${total} problemas`;
}

export type Veredito = 'integro' | 'adulterado';

export interface ResultadoComparavel {
  readonly veredito: Veredito;
  readonly problemas: readonly ProblemaExibido[];
}

function chaveDoProblema({ codigo, seq }: ProblemaExibido): string {
  return `${codigo}|${seq === null ? '' : seq}`;
}

/** Concordam se o veredito e a lista de problemas (código e `seq`) são iguais. */
export function resultadosConcordam(a: ResultadoComparavel, b: ResultadoComparavel): boolean {
  if (a.veredito !== b.veredito || a.problemas.length !== b.problemas.length) return false;
  const chavesA = a.problemas.map(chaveDoProblema).sort();
  const chavesB = b.problemas.map(chaveDoProblema).sort();
  return chavesA.every((chave, i) => chave === chavesB[i]);
}
