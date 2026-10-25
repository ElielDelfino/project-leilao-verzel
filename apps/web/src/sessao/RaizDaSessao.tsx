import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';

import type { Usuario } from '../api/auth';
import { ouvirSessaoExpirada } from '../api/cliente';
import { CHAVE_DA_SESSAO, CHAVE_DO_AVISO, substituirSessao } from './useSessao';

/**
 * Raiz das rotas: se o refresh falhar com a sessão em uso, limpa a sessão e leva a
 * `/entrar?retorno=<caminho>` com o aviso de sessão expirada (D11). Na carga inicial (ainda sem
 * usuário) a falha é silenciosa: o visitante é só anônimo.
 */
export function RaizDaSessao() {
  const queryClient = useQueryClient();
  const navegar = useNavigate();
  const { pathname, search } = useLocation();
  const atual = useRef(`${pathname}${search}`);

  useEffect(() => {
    atual.current = `${pathname}${search}`;
  }, [pathname, search]);

  useEffect(
    () =>
      ouvirSessaoExpirada((motivo) => {
        const usuario = queryClient.getQueryData<Usuario | null>(CHAVE_DA_SESSAO);
        if (!usuario) return;
        substituirSessao(queryClient, null);
        queryClient.setQueryData(CHAVE_DO_AVISO, motivo);
        void navegar(`/entrar?retorno=${encodeURIComponent(atual.current)}`, {
          replace: true,
          state: { aviso: motivo },
        });
      }),
    [navegar, queryClient],
  );

  return <Outlet />;
}
