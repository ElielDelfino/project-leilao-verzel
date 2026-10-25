// Corpos de entrada da tag auth (openapi.yaml: CadastroEntrada, LoginEntrada; specs/003 RF-01,
// RF-02). Objetos estritos: campo desconhecido → 422. Tamanhos contam caracteres (code points),
// como minLength/maxLength do JSON Schema e o char_length do Postgres.
import { z } from 'zod';

import { PAPEIS } from '../../common/auth/sessao.js';
import { EMAIL_MAXIMO, NOME_MAXIMO, NOME_MINIMO } from './schema.js';

const SENHA_MAXIMA = 128;
const SENHA_MINIMA_NO_CADASTRO = 10;
const SENHA_MINIMA_NO_LOGIN = 1;

function caracteres(texto: string): number {
  return [...texto].length;
}

function textoComTamanho(minimo: number, maximo: number) {
  return z.string().refine((texto) => {
    const tamanho = caracteres(texto);
    return tamanho >= minimo && tamanho <= maximo;
  });
}

const email = z.email().refine((texto) => caracteres(texto) <= EMAIL_MAXIMO);

export const esquemaDoCadastro = z.strictObject({
  nome: textoComTamanho(NOME_MINIMO, NOME_MAXIMO),
  email,
  senha: textoComTamanho(SENHA_MINIMA_NO_CADASTRO, SENHA_MAXIMA),
  papel: z.enum(PAPEIS),
});
export type DadosDoCadastro = z.infer<typeof esquemaDoCadastro>;

export const esquemaDoLogin = z.strictObject({
  email,
  senha: textoComTamanho(SENHA_MINIMA_NO_LOGIN, SENHA_MAXIMA),
});
export type DadosDoLogin = z.infer<typeof esquemaDoLogin>;
