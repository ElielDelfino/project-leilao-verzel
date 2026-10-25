// Forma canônica JCS (RFC 8785) do subconjunto do lance e do selo (specs/008 §Forma canônica, ADR 0031 D2).
// Só aceita objetos planos com strings ASCII, inteiros seguros e null: para esse subconjunto,
// "chaves em ordem alfabética + JSON.stringify" produz o mesmo texto que a JCS, sem biblioteca.

/** Valores aceitos na forma canônica. */
export type ValorCanonico = string | number | null;

/** Objeto plano que entra na forma canônica. */
export type ObjetoCanonico = Readonly<Record<string, ValorCanonico>>;

/** Erro de domínio: o objeto está fora do subconjunto canônico. A mensagem cita só a chave. */
export class ErroDeCanonico extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ErroDeCanonico';
  }
}

const ASCII = /^\p{ASCII}*$/u;

function validarValor(chave: string, valor: unknown): void {
  if (valor === null) return;
  if (typeof valor === 'string') {
    if (!ASCII.test(valor)) throw new ErroDeCanonico(`campo ${chave}: string fora do ASCII`);
    return;
  }
  if (typeof valor === 'number') {
    if (!Number.isSafeInteger(valor))
      throw new ErroDeCanonico(`campo ${chave}: não é inteiro seguro`);
    return;
  }
  throw new ErroDeCanonico(`campo ${chave}: tipo fora da forma canônica`);
}

/**
 * Texto canônico de `objeto`: chaves ordenadas por unidades UTF-16 (a ordem da RFC 8785 §3.2.3,
 * que para ASCII é a de `Array.prototype.sort`), sem espaços. Lança {@link ErroDeCanonico}.
 *
 * Os membros são montados um a um: um objeto intermediário não serviria, porque o JS põe as
 * chaves numéricas ("1") antes das demais e o `JSON.stringify` desfaria a ordem.
 */
export function canonicalizar(objeto: ObjetoCanonico): string {
  const membros = Object.keys(objeto)
    .sort()
    .map((chave) => {
      if (!ASCII.test(chave)) throw new ErroDeCanonico('chave fora do ASCII');
      const valor: unknown = objeto[chave];
      validarValor(chave, valor);
      return `${JSON.stringify(chave)}:${JSON.stringify(valor)}`;
    });
  return `{${membros.join(',')}}`;
}
