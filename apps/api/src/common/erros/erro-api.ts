import type { CodigoDeErro } from './codigos.js';

export type DetalhesDoErro = Readonly<Record<string, unknown>>;

export interface DadosDoErroApi {
  readonly codigo: CodigoDeErro;
  /** Status HTTP da resposta (4xx ou 5xx). */
  readonly status: number;
  /** Mensagem pública; o front traduz pelo código (specs/012). Nunca inclua PII nem segredos. */
  readonly mensagem: string;
  readonly detalhes?: DetalhesDoErro;
}

const STATUS_MINIMO_DE_ERRO = 400;
const STATUS_MAXIMO_DE_ERRO = 599;

/** Erro esperado da API: o filtro global o converte no envelope `{ sucesso: false, erro }`. */
export class ErroApi extends Error {
  override readonly name = 'ErroApi';
  readonly codigo: CodigoDeErro;
  readonly status: number;
  readonly detalhes: DetalhesDoErro | undefined;

  constructor(dados: DadosDoErroApi) {
    super(dados.mensagem);
    if (
      !Number.isInteger(dados.status) ||
      dados.status < STATUS_MINIMO_DE_ERRO ||
      dados.status > STATUS_MAXIMO_DE_ERRO
    ) {
      throw new RangeError(`Status HTTP de erro inválido: ${dados.status}`);
    }
    this.codigo = dados.codigo;
    this.status = dados.status;
    this.detalhes = dados.detalhes;
  }
}
