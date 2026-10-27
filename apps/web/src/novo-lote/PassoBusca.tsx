import { useQuery } from '@tanstack/react-query';
import { useState, type SubmitEvent } from 'react';

import { buscarCartas, type CartaDaBusca } from '../api/catalogo';
import { Campo } from '../formularios/Campo';
import { TAMANHO_DO_CATALOGO, TAMANHO_MAXIMO_DE_PAGINAS, Miniatura } from './Miniatura';
import { Paginacao } from '../lotes/Paginacao';
import { ROTULOS_DE_RARIDADE } from '../lotes/rotulos';
import { MENSAGEM_BUSCA_VAZIA, textoDoErroDoCatalogo } from './mensagensDoCatalogo';

const MAXIMO_DA_BUSCA = 200;

interface Props {
  q: string;
  pagina: number;
  aviso?: string | undefined;
  aoBuscar: (q: string) => void;
  aoIrParaPagina: (pagina: number) => void;
  aoEscolher: (carta: CartaDaBusca) => void;
}

function textoDoTotal(total: number): string {
  return total === 1 ? '1 carta encontrada' : `${total} cartas encontradas`;
}

/** Passo 1 de specs/012 §Novo lote: busca na Scryfall e escolha da carta. */
export function PassoBusca({ q, pagina, aviso, aoBuscar, aoIrParaPagina, aoEscolher }: Props) {
  const [texto, setTexto] = useState(q);
  const [erro, setErro] = useState<string | undefined>();
  const buscaAtiva = q !== '';
  const consulta = useQuery({
    queryKey: ['catalogo', 'cartas', q, pagina],
    queryFn: () => buscarCartas(q, pagina),
    enabled: buscaAtiva,
    retry: false,
  });

  function enviar(evento: SubmitEvent<HTMLFormElement>) {
    evento.preventDefault();
    const valor = texto.trim();
    if (valor.length < 1 || valor.length > MAXIMO_DA_BUSCA) {
      setErro(MENSAGEM_BUSCA_VAZIA);
      return;
    }
    setErro(undefined);
    // Mesma busca depois de uma falha: a URL não muda, então refaz a consulta.
    if (valor === q && pagina === 1) void consulta.refetch();
    else aoBuscar(valor);
  }

  const total = consulta.data?.meta.total ?? 0;
  const totalPaginas = Math.min(Math.ceil(total / TAMANHO_DO_CATALOGO), TAMANHO_MAXIMO_DE_PAGINAS);

  return (
    <div className="cartao mt-6 p-6">
      <h2 tabIndex={-1} data-foco-do-passo className="text-lg font-bold">
        Buscar carta
      </h2>
      {aviso ? (
        <p role="alert" className="aviso mt-4">
          {aviso}
        </p>
      ) : null}
      <form noValidate onSubmit={enviar} className="mt-4 flex max-w-xl flex-col gap-4">
        <Campo
          nome="busca"
          rotulo="Buscar carta na Scryfall"
          maxLength={MAXIMO_DA_BUSCA}
          ajuda="Digite o nome da carta ou use a sintaxe de busca da Scryfall."
          valor={texto}
          aoMudar={setTexto}
          erro={erro}
        />
        <button type="submit" className="botao-primario self-start">
          Buscar cartas
        </button>
      </form>
      <div className="mt-6">
        {buscaAtiva && consulta.isFetching ? <p role="status">Buscando cartas…</p> : null}
        {consulta.error && !consulta.isFetching ? (
          <p role="alert" className="aviso">
            {textoDoErroDoCatalogo(consulta.error)}
          </p>
        ) : null}
        <p aria-live="polite" className="text-sm font-semibold text-texto-suave">
          {consulta.data && !consulta.isFetching ? textoDoTotal(total) : ''}
        </p>
        {consulta.data && !consulta.isFetching && total === 0 ? (
          <p>Nenhuma carta encontrada para esta busca.</p>
        ) : null}
        {consulta.data && !consulta.isFetching && total > 0 ? (
          <>
            <ul className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {consulta.data.cartas.map((carta) => (
                <li
                  key={carta.scryfallId}
                  className="flex flex-col overflow-hidden rounded-2xl border border-borda bg-superficie transition-colors hover:border-primario"
                >
                  <div className="flex justify-center bg-linear-to-b from-primario/10 to-poco px-4 py-5">
                    <Miniatura carta={carta} tamanho="grande" />
                  </div>
                  <div className="flex flex-1 flex-col gap-1 border-t border-borda p-4 text-sm text-texto-suave">
                    <span className="font-bold text-texto">{carta.nome}</span>
                    <span>
                      {carta.colecao} · {ROTULOS_DE_RARIDADE[carta.raridade]}
                    </span>
                    <span>{carta.tipo}</span>
                    {carta.artista ? <span>Arte: {carta.artista}</span> : null}
                    <button
                      type="button"
                      aria-label={`Escolher ${carta.nome}`}
                      onClick={() => aoEscolher(carta)}
                      className="botao-secundario mt-auto self-start"
                    >
                      Escolher esta carta
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <Paginacao pagina={pagina} totalPaginas={totalPaginas} aoIr={aoIrParaPagina} />
          </>
        ) : null}
      </div>
    </div>
  );
}
