import type { CodigoDeErro } from './codigos.js';

/** Valores aceitos em `detalhes`: só primitivos, para não vazar objetos (e PII) aninhados. */
export type ValorDeDetalhe = string | number | boolean | null;

export type DetalhesDoErro = Readonly<Record<string, ValorDeDetalhe>>;

export interface DadosDoErroApi {
  readonly codigo: CodigoDeErro;
  /** Status HTTP da resposta (4xx ou 5xx). */
  readonly status: number;
  /** Mensagem pública; o front traduz pelo código (specs/012). Nunca inclua PII nem segredos. */
  readonly mensagem: string;
  /** Vai ao cliente como está. Nunca inclua e-mail, nome, token ou segredo. */
  readonly detalhes?: DetalhesDoErro;
}

const STATUS_MINIMO_DE_ERRO = 400;
const STATUS_MAXIMO_DE_ERRO = 599;

function ehValorDeDetalhe(valor: unknown): valor is ValorDeDetalhe {
  return (
    valor === null ||
    typeof valor === 'string' ||
    typeof valor === 'boolean' ||
    (typeof valor === 'number' && Number.isFinite(valor))
  );
}

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
    // Reforço em tempo de execução para chamadas que escapem dos tipos (ex.: valor `unknown`).
    // A mensagem cita só a chave, nunca o valor.
    const chaveInvalida = Object.entries(dados.detalhes ?? {}).find(
      ([, valor]) => !ehValorDeDetalhe(valor),
    )?.[0];
    if (chaveInvalida !== undefined) {
      throw new TypeError(`ErroApi.detalhes.${chaveInvalida} precisa ser um valor primitivo`);
    }
    this.codigo = dados.codigo;
    this.status = dados.status;
    this.detalhes = dados.detalhes;
  }
}
