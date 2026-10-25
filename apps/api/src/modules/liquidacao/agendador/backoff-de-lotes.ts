// Backoff por lote "veneno" do agendador (specs/010 §Lote "veneno"): estado em memória, por
// processo. Cada falha exclui o lote da varredura por 2 s, 4 s, 8 s... até 60 s; o tempo expira
// sozinho (o lote volta à seleção e é tentado de novo). Sucesso, ou a saída do lote da seleção,
// zera o contador. O conjunto tem tamanho limitado; ao encher, sai o que expira primeiro.
export const BACKOFF_INICIAL_MS = 2_000;
export const BACKOFF_TETO_MS = 60_000;
export const LIMITE_DE_LOTES_EM_BACKOFF = 1_000;

interface Entrada {
  falhas: number;
  /** Instante (relógio monotônico, ms) em que o lote volta à seleção. */
  ateMs: number;
}

export class BackoffDeLotes {
  readonly #entradas = new Map<string, Entrada>();

  /** Ids ainda excluídos da varredura no instante `agoraMs`. */
  excluidos(agoraMs: number): string[] {
    const ids: string[] = [];
    for (const [id, entrada] of this.#entradas) {
      if (entrada.ateMs > agoraMs) ids.push(id);
    }
    return ids;
  }

  /** Registra uma falha; devolve se foi a primeira (e só ela dispara o alerta). */
  falhar(id: string, agoraMs: number): { primeira: boolean; esperaMs: number } {
    const anterior = this.#entradas.get(id);
    const falhas = (anterior?.falhas ?? 0) + 1;
    const esperaMs = Math.min(BACKOFF_INICIAL_MS * 2 ** (falhas - 1), BACKOFF_TETO_MS);
    if (anterior === undefined && this.#entradas.size >= LIMITE_DE_LOTES_EM_BACKOFF) {
      this.#descartarOMaisAntigo();
    }
    this.#entradas.set(id, { falhas, ateMs: agoraMs + esperaMs });
    return { primeira: falhas === 1, esperaMs };
  }

  /** Encerramento concluído (ou lote que já não é candidato): zera o contador. */
  zerar(id: string): void {
    this.#entradas.delete(id);
  }

  /**
   * Zera os lotes cujo backoff já expirou e que NÃO voltaram na varredura (encerrados por outra
   * instância). Só chamar com a varredura completa, isto é, abaixo do limite.
   */
  zerarOsQueSairamDaSelecao(agoraMs: number, candidatos: readonly string[]): void {
    const presentes = new Set(candidatos);
    for (const [id, entrada] of this.#entradas) {
      if (entrada.ateMs <= agoraMs && !presentes.has(id)) this.#entradas.delete(id);
    }
  }

  get tamanho(): number {
    return this.#entradas.size;
  }

  #descartarOMaisAntigo(): void {
    let alvo: string | undefined;
    let menor = Number.POSITIVE_INFINITY;
    for (const [id, entrada] of this.#entradas) {
      if (entrada.ateMs < menor) {
        menor = entrada.ateMs;
        alvo = id;
      }
    }
    if (alvo !== undefined) this.#entradas.delete(alvo);
  }
}
