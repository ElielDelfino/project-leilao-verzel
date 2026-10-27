import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';

import type { PaginaDe } from '../api/arremates';
import { ErroDoServidor } from '../formularios/ErroDoServidor';

const CLASSE_BOTAO = 'botao-secundario';

interface Props<T> {
  /** Distingue o cache de cada aba. */
  chave: string;
  /** Nome acessível da lista e da paginação. */
  rotulo: string;
  /** Texto do estado de carregamento da aba. */
  carregando: string;
  pagina: number;
  buscar: (pagina: number) => Promise<PaginaDe<T>>;
  chaveDoItem: (item: T) => string;
  renderizar: (item: T) => ReactNode;
  vazio: ReactNode;
  irParaPagina: (pagina: number, substituir?: boolean) => void;
}

/**
 * Lista paginada de uma aba. A página anterior fica na tela enquanto a nova carrega
 * (`keepPreviousData`) e os botões de paginação nunca são desmontados, então o foco não se perde.
 */
export function ListaPaginada<T>({
  chave,
  rotulo,
  carregando,
  pagina,
  buscar,
  chaveDoItem,
  renderizar,
  vazio,
  irParaPagina,
}: Props<T>) {
  const consulta = useQuery({
    queryKey: ['meus-arremates', chave, pagina],
    queryFn: () => buscar(pagina),
    retry: false,
    placeholderData: keepPreviousData,
  });

  const total = consulta.data?.meta.total ?? 0;
  const limite = consulta.data?.meta.limite ?? 24;
  const ultimaPagina = Math.max(1, Math.ceil(total / limite));
  const alemDaUltima = !consulta.isPlaceholderData && total > 0 && pagina > ultimaPagina;

  // Link antigo ou edição manual da URL: volta para a última página que existe.
  useEffect(() => {
    if (alemDaUltima) irParaPagina(ultimaPagina, true);
    // `irParaPagina` muda a cada render do pai; reagir à detecção basta.
  }, [alemDaUltima, ultimaPagina]);

  if (consulta.error) {
    return (
      <div className="flex flex-col items-start gap-4">
        <ErroDoServidor erro={consulta.error} />
        <button type="button" onClick={() => void consulta.refetch()} className={CLASSE_BOTAO}>
          Tentar de novo
        </button>
      </div>
    );
  }
  if (!consulta.data) return <p role="status">{carregando}</p>;
  if (total === 0) return <div>{vazio}</div>;

  const { itens } = consulta.data;
  const nota = (disponivel: boolean, alvo: number) => () => {
    if (disponivel) irParaPagina(alvo);
  };

  return (
    <>
      <ul
        aria-label={rotulo}
        aria-busy={consulta.isPlaceholderData}
        className="flex flex-col gap-4"
      >
        {itens.map((item) => (
          <li key={chaveDoItem(item)} className="cartao p-4">
            {renderizar(item)}
          </li>
        ))}
      </ul>
      <nav aria-label="Paginação" className="mt-6 flex items-center justify-center gap-4">
        {/* aria-disabled (e não disabled) mantém o botão focável: o foco não se perde na borda. */}
        <button
          type="button"
          aria-disabled={pagina <= 1}
          onClick={nota(pagina > 1, pagina - 1)}
          className={CLASSE_BOTAO}
        >
          Anterior
        </button>
        <span aria-live="polite" className="text-sm text-texto-suave">
          Página {pagina} de {ultimaPagina}
        </span>
        <button
          type="button"
          aria-disabled={pagina >= ultimaPagina}
          onClick={nota(pagina < ultimaPagina, pagina + 1)}
          className={CLASSE_BOTAO}
        >
          Próxima
        </button>
      </nav>
    </>
  );
}
