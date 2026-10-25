import type { CodigoDeErro } from '../mensagens/erros';

export interface DadosDoErroDaApi {
  status: number;
  codigo: CodigoDeErro;
  detalhes?: Record<string, unknown> | undefined;
  retryAfterSegundos?: number | undefined;
}

/**
 * Erro do envelope `{ sucesso: false, erro }` (specs/001 §Contratos). `status` 0 = a requisição
 * nem chegou à API (falha de rede). A `mensagem` da API nunca é guardada: o texto exibido vem do
 * mapa em `mensagens/erros.ts`.
 */
export class ErroDaApi extends Error {
  readonly status: number;
  readonly codigo: CodigoDeErro;
  readonly detalhes: Record<string, unknown> | undefined;
  readonly retryAfterSegundos: number | undefined;

  constructor({ status, codigo, detalhes, retryAfterSegundos }: DadosDoErroDaApi) {
    super(`${codigo} (${status})`);
    this.name = 'ErroDaApi';
    this.status = status;
    this.codigo = codigo;
    this.detalhes = detalhes;
    this.retryAfterSegundos = retryAfterSegundos;
  }

  /** Sem resposta da API: não se sabe se o servidor processou a requisição. */
  get falhaDeRede(): boolean {
    return this.status === 0;
  }

  /**
   * Resultado incerto (rede, 5xx ou 2xx com corpo que não é o envelope): o servidor pode ter
   * processado; repetir com a mesma Idempotency-Key é seguro.
   */
  get resultadoIncerto(): boolean {
    return this.status === 0 || this.status >= 500 || (this.status >= 200 && this.status < 300);
  }
}
