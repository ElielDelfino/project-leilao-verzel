// Envelope de resposta (specs/001 §Contratos).
import type { CodigoDeErro } from './erros/codigos.js';
import type { DetalhesDoErro } from './erros/erro-api.js';

export interface RespostaDeSucesso<T> {
  readonly sucesso: true;
  readonly dados: T;
}

export interface CorpoDoErro {
  readonly codigo: CodigoDeErro;
  readonly mensagem: string;
  readonly detalhes?: DetalhesDoErro;
}

export interface RespostaDeErro {
  readonly sucesso: false;
  readonly erro: CorpoDoErro;
}

export function sucesso<T>(dados: T): RespostaDeSucesso<T> {
  return { sucesso: true, dados };
}

export function falha(erro: CorpoDoErro): RespostaDeErro {
  return { sucesso: false, erro };
}
