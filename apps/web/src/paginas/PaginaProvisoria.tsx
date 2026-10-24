import type { ReactNode } from 'react';

export const NOME_DO_SITE = 'Casa de Leilões';

type Props = {
  titulo: string;
  children?: ReactNode;
};

// Página de rota ainda não implementada (tarefa 005). O <title> é içado para o <head> pelo React 19.
export function PaginaProvisoria({ titulo, children }: Props) {
  return (
    <>
      <title>{`${titulo} · ${NOME_DO_SITE}`}</title>
      <h1 className="text-3xl font-bold tracking-tight">{titulo}</h1>
      {children ?? <p className="mt-4 text-texto-suave">Em construção.</p>}
    </>
  );
}
