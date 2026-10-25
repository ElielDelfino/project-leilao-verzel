import type { Papel } from '../sessao/destino';

// Validação do cliente nos limites do contrato (openapi.yaml: CadastroEntrada, LoginEntrada) e
// mensagens por campo de D12 (tarefa 036). O servidor continua sendo a autoridade.
export const MENSAGEM_NOME = 'Use de 2 a 80 caracteres.';
export const MENSAGEM_EMAIL = 'Informe um e-mail válido.';
export const MENSAGEM_SENHA_CADASTRO = 'Use de 10 a 128 caracteres.';
export const MENSAGEM_SENHA_LOGIN = 'Informe a senha.';
export const MENSAGEM_PAPEL = 'Escolha Licitante ou Leiloeiro.';

const EMAIL_MAXIMO = 254;
const FORMATO_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type Erros<Campo extends string> = Partial<Record<Campo, string>>;

function tamanhoEntre(texto: string, minimo: number, maximo: number): boolean {
  return texto.length >= minimo && texto.length <= maximo;
}

const emailValido = (email: string) => email.length <= EMAIL_MAXIMO && FORMATO_EMAIL.test(email);

export function papelValido(valor: string): valor is Papel {
  return valor === 'licitante' || valor === 'leiloeiro';
}

export interface CamposDoCadastro {
  nome: string;
  email: string;
  senha: string;
  papel: string;
}

export function validarCadastro(campos: CamposDoCadastro): Erros<keyof CamposDoCadastro> {
  return {
    ...(tamanhoEntre(campos.nome.trim(), 2, 80) ? {} : { nome: MENSAGEM_NOME }),
    ...(emailValido(campos.email.trim()) ? {} : { email: MENSAGEM_EMAIL }),
    ...(tamanhoEntre(campos.senha, 10, 128) ? {} : { senha: MENSAGEM_SENHA_CADASTRO }),
    ...(papelValido(campos.papel) ? {} : { papel: MENSAGEM_PAPEL }),
  };
}

export interface CamposDoLogin {
  email: string;
  senha: string;
}

export function validarLogin(campos: CamposDoLogin): Erros<keyof CamposDoLogin> {
  return {
    ...(emailValido(campos.email.trim()) ? {} : { email: MENSAGEM_EMAIL }),
    ...(tamanhoEntre(campos.senha, 1, 128) ? {} : { senha: MENSAGEM_SENHA_LOGIN }),
  };
}

/** Foca o primeiro campo inválido na ordem dada (WCAG 3.3.1: o erro é anunciado e alcançável). */
export function focarPrimeiroInvalido(
  formulario: HTMLFormElement,
  ordem: readonly string[],
  erros: Record<string, string | undefined>,
): void {
  const nome = ordem.find((campo) => erros[campo] !== undefined);
  if (nome === undefined) return;
  const elemento = formulario.elements.namedItem(nome);
  const alvo = elemento instanceof RadioNodeList ? elemento[0] : elemento;
  if (alvo instanceof HTMLElement) alvo.focus();
}
