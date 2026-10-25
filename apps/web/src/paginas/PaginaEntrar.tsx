import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type SubmitEvent } from 'react';
import { Link, useLocation } from 'react-router';

import { entrar } from '../api/auth';
import { Campo } from '../formularios/Campo';
import { ErroDoServidor } from '../formularios/ErroDoServidor';
import { focarPrimeiroInvalido, validarLogin, type Erros } from '../formularios/validacao';
import { tituloDaPagina } from '../layout/site';
import { mensagemDoErro } from '../mensagens/erros';
import { CHAVE_DO_AVISO, substituirSessao } from '../sessao/useSessao';

const TITULO = 'Entrar';
const CAMPOS = ['email', 'senha'] as const;

export function PaginaEntrar() {
  const queryClient = useQueryClient();
  const { state } = useLocation() as { state: { aviso?: string } | null };
  const [erros, setErros] = useState<Erros<(typeof CAMPOS)[number]>>({});
  const login = useMutation({
    mutationFn: entrar,
    // A guarda de /entrar redireciona para o retorno permitido assim que a sessão existe.
    onSuccess: (usuario) => substituirSessao(queryClient, usuario),
  });

  // O aviso vale para esta chegada; não reaparece em visitas futuras.
  useEffect(() => {
    queryClient.removeQueries({ queryKey: CHAVE_DO_AVISO });
  }, [queryClient]);

  function enviar(evento: SubmitEvent<HTMLFormElement>) {
    evento.preventDefault();
    const dados = new FormData(evento.currentTarget);
    const campos = {
      email: String(dados.get('email') ?? ''),
      senha: String(dados.get('senha') ?? ''),
    };
    const encontrados = validarLogin(campos);
    setErros(encontrados);
    if (Object.keys(encontrados).length > 0) {
      focarPrimeiroInvalido(evento.currentTarget, CAMPOS, encontrados);
      return;
    }
    login.mutate({ email: campos.email.trim(), senha: campos.senha });
  }

  return (
    <>
      <title>{tituloDaPagina(TITULO)}</title>
      <h1 className="text-3xl font-bold tracking-tight">{TITULO}</h1>
      {state?.aviso === 'SESSAO_EXPIRADA' || state?.aviso === 'NAO_AUTENTICADO' ? (
        <p role="status" className="mt-4 font-medium">
          {mensagemDoErro(state.aviso)}
        </p>
      ) : null}
      <form noValidate onSubmit={enviar} className="mt-6 flex max-w-md flex-col gap-4">
        {login.error ? <ErroDoServidor erro={login.error} /> : null}
        <Campo nome="email" rotulo="E-mail" tipo="email" autoComplete="email" erro={erros.email} />
        <Campo
          nome="senha"
          rotulo="Senha"
          tipo="password"
          autoComplete="current-password"
          erro={erros.senha}
        />
        <button
          type="submit"
          disabled={login.isPending}
          className="min-h-11 rounded-md bg-primario px-4 font-medium text-texto-sobre-primario"
        >
          {login.isPending ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
      <p className="mt-6">
        Ainda não tem conta? <Link to="/cadastro">Criar conta</Link>
      </p>
    </>
  );
}
