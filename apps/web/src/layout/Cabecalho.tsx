import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, NavLink, useNavigate } from 'react-router';

import { sair } from '../api/auth';
import { ErroDaApi } from '../api/erro';
import { mensagemDoErro } from '../mensagens/erros';
import { substituirSessao, useSessao } from '../sessao/useSessao';
import { AlternarTema } from '../tema/AlternarTema';
import { NOME_DO_SITE } from './site';
import { IndicadorDeslizante } from './IndicadorDeslizante';

/** Marca: só o nome do site, que também é o nome acessível do link. */
function Marca() {
  return (
    <Link to="/" className="text-lg font-extrabold tracking-tight text-texto no-underline">
      {NOME_DO_SITE}
    </Link>
  );
}

function Menu() {
  const { usuario } = useSessao();
  const queryClient = useQueryClient();
  const navegar = useNavigate();
  const saida = useMutation({
    mutationFn: sair,
    // Navega antes de limpar a sessão: senão a guarda da rota atual redireciona para /entrar.
    onSuccess: async () => {
      await navegar('/');
      substituirSessao(queryClient, null);
    },
  });

  if (!usuario) {
    return (
      <>
        <NavLink to="/entrar" className="pilula">
          Entrar
        </NavLink>
        <Link to="/cadastro" className="botao-primario">
          Criar conta
        </Link>
      </>
    );
  }
  return (
    <>
      <div className="pilulas">
        <IndicadorDeslizante />
        <NavLink to="/" end className="pilula">
          Vitrine
        </NavLink>
        {usuario.papel === 'licitante' ? (
          <>
            <NavLink to="/carteira" className="pilula">
              Carteira
            </NavLink>
            <NavLink to="/meus-arremates" className="pilula">
              Meus arremates
            </NavLink>
          </>
        ) : (
          <NavLink to="/painel" className="pilula">
            Painel
          </NavLink>
        )}
      </div>
      <span className="inline-flex min-h-11 items-center gap-2 rounded-full border border-borda bg-superficie py-1 pr-4 pl-1 text-sm font-semibold">
        <span
          aria-hidden="true"
          className="grid size-8 place-items-center rounded-full bg-poco text-xs font-bold text-texto-suave"
        >
          {usuario.nome.trim().charAt(0).toUpperCase()}
        </span>
        {usuario.nome}
      </span>
      <button
        type="button"
        disabled={saida.isPending}
        onClick={() => saida.mutate()}
        className="botao-secundario"
      >
        Sair
      </button>
      {saida.error ? (
        <span role="alert" className="text-sm font-medium text-perigo">
          {mensagemDoErro(saida.error instanceof ErroDaApi ? saida.error.codigo : 'INDISPONIVEL')}
        </span>
      ) : null}
    </>
  );
}

export function Cabecalho() {
  return (
    <header className="sticky top-0 z-40 border-b border-borda bg-fundo/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Marca />
        <nav aria-label="Principal" className="flex flex-wrap items-center gap-2 sm:gap-3">
          <Menu />
          <AlternarTema />
        </nav>
      </div>
    </header>
  );
}
