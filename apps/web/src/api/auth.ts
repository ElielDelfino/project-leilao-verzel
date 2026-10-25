import type { SchemasApi } from '@leilao/contracts';

import { requisitar } from './cliente';

export type Usuario = SchemasApi['Usuario'];
export type CadastroEntrada = SchemasApi['CadastroEntrada'];
export type LoginEntrada = SchemasApi['LoginEntrada'];

export async function obterUsuarioLogado(): Promise<Usuario> {
  const resposta = await requisitar<{ dados: Usuario }>('GET', '/api/auth/me');
  return resposta.dados;
}

export async function entrar(entrada: LoginEntrada): Promise<Usuario> {
  const resposta = await requisitar<SchemasApi['RespostaUsuarioLogado']>(
    'POST',
    '/api/auth/login',
    { corpo: entrada },
  );
  return resposta.dados.usuario;
}

export async function cadastrar(entrada: CadastroEntrada): Promise<Usuario> {
  const resposta = await requisitar<SchemasApi['RespostaUsuarioLogado']>(
    'POST',
    '/api/auth/cadastro',
    { corpo: entrada },
  );
  return resposta.dados.usuario;
}

export async function sair(): Promise<void> {
  await requisitar('POST', '/api/auth/logout');
}
