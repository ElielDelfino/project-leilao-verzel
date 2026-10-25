import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';

import { sair } from '../api/auth';
import { ErroDaApi } from '../api/erro';
import { mensagemDoErro } from '../mensagens/erros';
import { substituirSessao, useSessao } from '../sessao/useSessao';
import { AlternarTema } from '../tema/AlternarTema';
import { NOME_DO_SITE } from './site';

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
        <Link to="/entrar">Entrar</Link>
        <Link to="/cadastro">Criar conta</Link>
      </>
    );
  }
  return (
    <>
      {usuario.papel === 'licitante' ? (
        <>
          <Link to="/carteira">Carteira</Link>
          <Link to="/meus-arremates">Meus arremates</Link>
        </>
      ) : (
        <Link to="/painel">Painel</Link>
      )}
      <span className="font-medium">{usuario.nome}</span>
      <button
        type="button"
        disabled={saida.isPending}
        onClick={() => saida.mutate()}
        className="inline-flex min-h-11 items-center rounded-md border border-borda-controle bg-superficie px-3 text-sm font-medium text-texto hover:border-texto"
      >
        Sair
      </button>
      {saida.error ? (
        <span role="alert" className="text-sm">
          {mensagemDoErro(saida.error instanceof ErroDaApi ? saida.error.codigo : 'INDISPONIVEL')}
        </span>
      ) : null}
    </>
  );
}

export function Cabecalho() {
  return (
    <header className="border-b border-borda bg-superficie">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-3">
        <Link to="/" className="text-lg font-bold text-texto no-underline">
          {NOME_DO_SITE}
        </Link>
        <nav aria-label="Principal" className="flex flex-wrap items-center gap-4">
          <Menu />
          <AlternarTema />
        </nav>
      </div>
    </header>
  );
}
