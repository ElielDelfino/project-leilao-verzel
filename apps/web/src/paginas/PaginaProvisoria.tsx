import { tituloDaPagina } from '../layout/site';

type Props = {
  titulo: string;
};

// Página de rota ainda não implementada (tarefa 005). O <title> é içado para o <head> pelo React 19.
export function PaginaProvisoria({ titulo }: Props) {
  return (
    <>
      <title>{tituloDaPagina(titulo)}</title>
      <h1 className="text-3xl font-bold tracking-tight">{titulo}</h1>
      <p className="mt-4 text-texto-suave">Em construção.</p>
    </>
  );
}
