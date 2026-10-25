import { useQueryClient } from '@tanstack/react-query';
import { Navigate, Outlet, useLocation, useSearchParams } from 'react-router';

import { mensagemDoErro } from '../mensagens/erros';
import { PaginaAcessoNaoPermitido } from '../paginas/PaginaAcessoNaoPermitido';
import type { MotivoDaSessaoPerdida } from '../api/cliente';
import { destinoPosLogin, papelPodeAcessar } from './destino';
import { CHAVE_DO_AVISO, useSessao } from './useSessao';

function Carregando() {
  return (
    <p role="status" className="text-texto-suave">
      Carregando…
    </p>
  );
}

/** Rota de usuário logado (D11): anônimo vai a `/entrar?retorno=`; papel errado vê "Acesso não permitido". */
export function RotaRestrita() {
  const { carregando, erro, usuario } = useSessao();
  const { pathname, search } = useLocation();
  const queryClient = useQueryClient();

  if (carregando) return <Carregando />;
  if (erro) return <p role="alert">{mensagemDoErro(erro.codigo)}</p>;
  if (!usuario) {
    return (
      <Navigate
        to={`/entrar?retorno=${encodeURIComponent(`${pathname}${search}`)}`}
        replace
        state={{ aviso: queryClient.getQueryData<MotivoDaSessaoPerdida>(CHAVE_DO_AVISO) ?? null }}
      />
    );
  }
  if (!papelPodeAcessar(usuario.papel, pathname)) return <PaginaAcessoNaoPermitido />;
  return <Outlet />;
}

/** `/entrar` e `/cadastro`: quem já tem sessão vai para o `retorno` permitido ou o destino do papel. */
export function RotaAnonima() {
  const { carregando, usuario } = useSessao();
  const [params] = useSearchParams();

  if (carregando) return <Carregando />;
  if (usuario)
    return <Navigate to={destinoPosLogin(params.get('retorno'), usuario.papel)} replace />;
  return <Outlet />;
}
