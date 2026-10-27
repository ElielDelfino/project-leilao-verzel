import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type SubmitEvent } from 'react';
import { Link } from 'react-router';

import { cadastrar } from '../api/auth';
import { Campo } from '../formularios/Campo';
import { ErroDoServidor } from '../formularios/ErroDoServidor';
import {
  focarPrimeiroInvalido,
  papelValido,
  validarCadastro,
  type Erros,
} from '../formularios/validacao';
import { tituloDaPagina } from '../layout/site';
import { substituirSessao } from '../sessao/useSessao';

const TITULO = 'Cadastro';
const CAMPOS = ['nome', 'email', 'senha', 'papel'] as const;

export function PaginaCadastro() {
  const queryClient = useQueryClient();
  const [erros, setErros] = useState<Erros<(typeof CAMPOS)[number]>>({});
  const cadastro = useMutation({
    mutationFn: cadastrar,
    // A guarda de /cadastro leva ao destino do papel assim que a sessão existe.
    onSuccess: (usuario) => substituirSessao(queryClient, usuario),
  });

  function enviar(evento: SubmitEvent<HTMLFormElement>) {
    evento.preventDefault();
    const dados = new FormData(evento.currentTarget);
    const texto = (nome: string) => String(dados.get(nome) ?? '');
    const campos = {
      nome: texto('nome'),
      email: texto('email'),
      senha: texto('senha'),
      papel: texto('papel'),
    };
    const encontrados = validarCadastro(campos);
    setErros(encontrados);
    if (Object.keys(encontrados).length > 0 || !papelValido(campos.papel)) {
      focarPrimeiroInvalido(evento.currentTarget, CAMPOS, encontrados);
      return;
    }
    cadastro.mutate({
      nome: campos.nome.trim(),
      email: campos.email.trim(),
      senha: campos.senha,
      papel: campos.papel,
    });
  }

  return (
    <>
      <title>{tituloDaPagina(TITULO)}</title>
      <div className="cartao mx-auto mt-4 max-w-md p-6 sm:p-8">
        <h1 className="titulo-pagina">{TITULO}</h1>
        <form noValidate onSubmit={enviar} className="mt-6 flex flex-col gap-4">
          {cadastro.error ? <ErroDoServidor erro={cadastro.error} /> : null}
          <Campo nome="nome" rotulo="Nome" autoComplete="name" erro={erros.nome} />
          <Campo
            nome="email"
            rotulo="E-mail"
            tipo="email"
            autoComplete="email"
            erro={erros.email}
          />
          <Campo
            nome="senha"
            rotulo="Senha"
            tipo="password"
            autoComplete="new-password"
            erro={erros.senha}
          />
          <fieldset aria-describedby={erros.papel ? 'papel-erro' : undefined}>
            <legend className="rotulo">Papel</legend>
            <div className="mt-1 flex gap-3">
              <label className="flex min-h-11 flex-1 items-center gap-2 rounded-xl border border-borda-controle bg-poco px-3">
                <input type="radio" name="papel" value="licitante" className="accent-primario" />
                Licitante
              </label>
              <label className="flex min-h-11 flex-1 items-center gap-2 rounded-xl border border-borda-controle bg-poco px-3">
                <input type="radio" name="papel" value="leiloeiro" className="accent-primario" />
                Leiloeiro
              </label>
            </div>
            {erros.papel ? (
              <p id="papel-erro" className="mt-1 text-sm font-medium">
                {erros.papel}
              </p>
            ) : null}
          </fieldset>
          <button type="submit" disabled={cadastro.isPending} className="botao-primario w-full">
            {cadastro.isPending ? 'Criando conta…' : 'Criar conta'}
          </button>
        </form>
        <p className="mt-6 text-center text-texto-suave">
          Já tem conta? <Link to="/entrar">Entrar</Link>
        </p>
      </div>
    </>
  );
}
