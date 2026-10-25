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
      <h1 className="text-3xl font-bold tracking-tight">{TITULO}</h1>
      <form noValidate onSubmit={enviar} className="mt-6 flex max-w-md flex-col gap-4">
        {cadastro.error ? <ErroDoServidor erro={cadastro.error} /> : null}
        <Campo nome="nome" rotulo="Nome" autoComplete="name" erro={erros.nome} />
        <Campo nome="email" rotulo="E-mail" tipo="email" autoComplete="email" erro={erros.email} />
        <Campo
          nome="senha"
          rotulo="Senha"
          tipo="password"
          autoComplete="new-password"
          erro={erros.senha}
        />
        <fieldset aria-describedby={erros.papel ? 'papel-erro' : undefined}>
          <legend className="font-medium">Papel</legend>
          <div className="mt-1 flex gap-6">
            <label className="flex min-h-11 items-center gap-2">
              <input type="radio" name="papel" value="licitante" />
              Licitante
            </label>
            <label className="flex min-h-11 items-center gap-2">
              <input type="radio" name="papel" value="leiloeiro" />
              Leiloeiro
            </label>
          </div>
          {erros.papel ? (
            <p id="papel-erro" className="mt-1 text-sm font-medium">
              {erros.papel}
            </p>
          ) : null}
        </fieldset>
        <button
          type="submit"
          disabled={cadastro.isPending}
          className="min-h-11 rounded-md bg-primario px-4 font-medium text-texto-sobre-primario"
        >
          {cadastro.isPending ? 'Criando conta…' : 'Criar conta'}
        </button>
      </form>
      <p className="mt-6">
        Já tem conta? <Link to="/entrar">Entrar</Link>
      </p>
    </>
  );
}
