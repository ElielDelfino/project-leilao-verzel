import { tituloDaPagina } from '../layout/site';

type Props = {
  titulo: string;
};

// Página de rota ainda não implementada (tarefa 005). O <title> é içado para o <head> pelo React 19.
export function PaginaProvisoria({ titulo }: Props) {
  return (
    <>
      <title>{tituloDaPagina(titulo)}</title>
      <div className="cartao mx-auto mt-8 max-w-lg p-6 text-center sm:p-10">
        <h1 className="titulo-pagina">{titulo}</h1>
        <p className="mt-4 text-texto-suave">Em construção.</p>
      </div>
    </>
  );
}
