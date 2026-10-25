import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { obterUsuarioLogado, type Usuario } from '../api/auth';
import { ErroDaApi } from '../api/erro';

export const CHAVE_DA_SESSAO = ['sessao'] as const;
/** Marca que a sessão expirou durante o uso, para o redirecionamento da guarda levar o aviso. */
export const CHAVE_DO_AVISO = ['sessao-aviso'] as const;

/** Sem sessão (nem recuperável pelo refresh) é "anônimo", não erro (D11: sem mensagem na carga). */
async function carregarSessao(): Promise<Usuario | null> {
  try {
    return await obterUsuarioLogado();
  } catch (erro) {
    if (erro instanceof ErroDaApi && (erro.status === 401 || erro.codigo === 'SESSAO_EXPIRADA')) {
      return null;
    }
    throw erro;
  }
}

/**
 * Troca a sessão no cache e descarta o resto do cache do servidor: dados de um usuário (saldo,
 * extrato) nunca podem aparecer para outro.
 */
export function substituirSessao(queryClient: QueryClient, usuario: Usuario | null): void {
  queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== CHAVE_DA_SESSAO[0] });
  queryClient.setQueryData(CHAVE_DA_SESSAO, usuario);
}

export interface EstadoDaSessao {
  carregando: boolean;
  /** Falha que não é "sem sessão" (rede, 5xx). */
  erro: ErroDaApi | null;
  usuario: Usuario | null;
  definirUsuario: (usuario: Usuario | null) => void;
}

/** A sessão vive no cache do TanStack Query (`GET /api/auth/me`), não numa store própria. */
export function useSessao(): EstadoDaSessao {
  const queryClient = useQueryClient();
  const consulta = useQuery({
    queryKey: CHAVE_DA_SESSAO,
    queryFn: carregarSessao,
    retry: false,
    staleTime: Infinity,
  });

  return {
    carregando: consulta.isPending,
    erro: consulta.error instanceof ErroDaApi ? consulta.error : null,
    usuario: consulta.data ?? null,
    definirUsuario: (usuario) => substituirSessao(queryClient, usuario),
  };
}
