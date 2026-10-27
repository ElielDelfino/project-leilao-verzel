import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useEffect, type KeyboardEvent } from 'react';
import { useSearchParams } from 'react-router';

import {
  listarLotes,
  type FiltrosDaVitrine,
  type PaginaDeLotes,
  type StatusDaVitrine,
} from '../api/lotes';
import { ErroDoServidor, textoDoErro } from '../formularios/ErroDoServidor';
import { tituloDaPagina } from '../layout/site';
import { CartaoDoLote } from '../lotes/CartaoDoLote';
import {
  ORDENS,
  STATUS_DA_VITRINE,
  TAMANHO_DA_PAGINA,
  escreverFiltros,
  lerFiltros,
  temFiltroDeBusca,
} from '../lotes/estadoDaVitrine';
import { FormularioDeBusca } from '../lotes/FormularioDeBusca';
import { Paginacao } from '../lotes/Paginacao';
import { CHAVE_DA_VITRINE } from '../tempo-real/cacheDaVitrine';
import { useVitrineAoVivo } from '../tempo-real/useVitrineAoVivo';
import { IndicadorDeslizante } from '../layout/IndicadorDeslizante';

const TITULO = 'Vitrine';
const ID_PAINEL = 'painel-da-vitrine';

const ABAS: Record<StatusDaVitrine, { rotulo: string; vazio: string }> = {
  ao_vivo: { rotulo: 'Ao vivo', vazio: 'Nenhum lote ao vivo agora.' },
  agendado: { rotulo: 'Agendados', vazio: 'Nenhum lote agendado.' },
  encerrado: { rotulo: 'Encerrados', vazio: 'Nenhum lote encerrado ainda.' },
};

const ROTULOS_DE_ORDEM = {
  termina_antes: 'Termina antes',
  mais_recente: 'Mais recente',
  maior_lance: 'Maior lance',
} as const;

const CLASSE_BOTAO_SECUNDARIO = 'botao-secundario';

const idDaAba = (status: StatusDaVitrine) => `aba-${status}`;

function textoDoTotal(total: number): string {
  return total === 1 ? '1 lote encontrado' : `${total} lotes encontrados`;
}

export function PaginaVitrine() {
  const [params, setParams] = useSearchParams();
  const filtros = lerFiltros(params);

  // Cada mudança cria uma entrada de histórico; `substituir` só para a correção de página.
  function ir(novos: FiltrosDaVitrine, substituir = false) {
    setParams(escreverFiltros(novos), { replace: substituir });
  }
  const mudar = (parcial: Partial<FiltrosDaVitrine>) => ir({ ...filtros, ...parcial, pagina: 1 });

  useVitrineAoVivo();

  const consulta = useQuery({
    queryKey: [...CHAVE_DA_VITRINE, escreverFiltros(filtros).toString()],
    queryFn: () => listarLotes(filtros),
    retry: false,
    // Troca de filtro, página ou refetch do tempo real mantém a lista anterior na tela.
    placeholderData: keepPreviousData,
  });

  const total = consulta.data?.meta.total ?? 0;
  const totalPaginas = Math.ceil(total / TAMANHO_DA_PAGINA);
  const paginaAlemDaUltima = total > 0 && filtros.pagina > totalPaginas;
  useEffect(() => {
    if (paginaAlemDaUltima) {
      setParams(escreverFiltros({ ...filtros, pagina: totalPaginas }), { replace: true });
    }
    // `filtros` é derivado de `params`; reagir à detecção basta.
  }, [paginaAlemDaUltima, totalPaginas]);

  function teclaNaAba(evento: KeyboardEvent<HTMLButtonElement>) {
    const passo = evento.key === 'ArrowRight' ? 1 : evento.key === 'ArrowLeft' ? -1 : 0;
    if (passo === 0) return;
    evento.preventDefault();
    const indice = STATUS_DA_VITRINE.indexOf(filtros.status);
    const proximo =
      STATUS_DA_VITRINE[(indice + passo + STATUS_DA_VITRINE.length) % STATUS_DA_VITRINE.length];
    if (proximo === undefined) return;
    mudar({ status: proximo });
    document.getElementById(idDaAba(proximo))?.focus();
  }

  const chaveDoFormulario = [filtros.q, filtros.raridade, filtros.precoMin, filtros.precoMax].join(
    '|',
  );
  const limpar = () =>
    ir({
      ...filtros,
      q: undefined,
      raridade: undefined,
      precoMin: undefined,
      precoMax: undefined,
      pagina: 1,
    });

  return (
    <>
      <title>{tituloDaPagina(TITULO)}</title>
      <section className="relative overflow-hidden rounded-3xl border border-borda bg-linear-to-br from-primario/15 via-superficie to-poco px-5 py-7 sm:px-10 sm:py-10">
        {/* Brilho decorativo no canto, no hero da vitrine. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full bg-primario/20 blur-3xl"
        />
        <div className="relative">
          <p className="selo border border-borda bg-poco text-texto-suave">Casa de Leilões</p>
          <h1 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">{TITULO}</h1>
          <p className="mt-2 max-w-xl text-sm text-texto-suave sm:text-base">
            Cartas Magic em leilão com lances ao vivo e histórico que qualquer pessoa pode auditar.
          </p>
          <div
            role="tablist"
            aria-label="Status dos lotes"
            className="pilulas mt-6 grid w-full grid-cols-3 sm:inline-flex sm:w-auto"
          >
            <IndicadorDeslizante />
            {STATUS_DA_VITRINE.map((status) => {
              const selecionada = status === filtros.status;
              return (
                <button
                  key={status}
                  id={idDaAba(status)}
                  type="button"
                  role="tab"
                  aria-selected={selecionada}
                  aria-controls={ID_PAINEL}
                  tabIndex={selecionada ? 0 : -1}
                  onClick={() => mudar({ status })}
                  onKeyDown={teclaNaAba}
                  className="pilula min-h-11 justify-center"
                >
                  {ABAS[status].rotulo}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <div className="mt-6">
        <FormularioDeBusca
          key={chaveDoFormulario}
          filtros={filtros}
          aoFiltrar={(novos) => mudar(novos)}
          aoLimpar={limpar}
        />
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
        <label htmlFor="ordem" className="rotulo">
          Ordenar por
        </label>{' '}
        <select
          id="ordem"
          value={filtros.ordem}
          onChange={(e) => {
            const ordem = ORDENS.find((o) => o === e.target.value);
            if (ordem) mudar({ ordem });
          }}
          className="controle w-auto"
        >
          {ORDENS.map((ordem) => (
            <option key={ordem} value={ordem}>
              {ROTULOS_DE_ORDEM[ordem]}
            </option>
          ))}
        </select>
      </div>

      <div
        id={ID_PAINEL}
        role="tabpanel"
        aria-labelledby={idDaAba(filtros.status)}
        className="mt-6"
      >
        <ConteudoDaLista
          consulta={consulta}
          filtros={filtros}
          totalPaginas={totalPaginas}
          aoLimpar={limpar}
          aoIrParaPagina={(pagina) => ir({ ...filtros, pagina })}
        />
      </div>
    </>
  );
}

interface ConteudoProps {
  consulta: UseQueryResult<PaginaDeLotes>;
  filtros: FiltrosDaVitrine;
  totalPaginas: number;
  aoLimpar: () => void;
  aoIrParaPagina: (pagina: number) => void;
}

function ConteudoDaLista({
  consulta,
  filtros,
  totalPaginas,
  aoLimpar,
  aoIrParaPagina,
}: ConteudoProps) {
  if (consulta.error && !consulta.data) {
    return (
      <div className="flex flex-col items-start gap-4">
        <ErroDoServidor erro={consulta.error} />
        <BotaoTentarDeNovo aoClicar={() => void consulta.refetch()} />
      </div>
    );
  }
  if (!consulta.data) {
    return (
      <>
        <p role="status">Carregando lotes…</p>
        <ul aria-busy="true" />
      </>
    );
  }

  // A falha de um refetch (resync) com a lista em tela não a derruba: avisa e mantém os cards.
  const aviso = consulta.error ? (
    <div className="mb-4 flex flex-col items-start gap-4">
      <p role="alert" className="aviso">
        Não foi possível atualizar a lista. {textoDoErro(consulta.error)}
      </p>
      <BotaoTentarDeNovo aoClicar={() => void consulta.refetch()} />
    </div>
  ) : null;
  return (
    <>
      {aviso}
      <ListaDeLotes
        dados={consulta.data}
        isPlaceholderData={consulta.isPlaceholderData}
        filtros={filtros}
        totalPaginas={totalPaginas}
        aoLimpar={aoLimpar}
        aoIrParaPagina={aoIrParaPagina}
      />
    </>
  );
}

function BotaoTentarDeNovo({ aoClicar }: { aoClicar: () => void }) {
  return (
    <button type="button" onClick={aoClicar} className={CLASSE_BOTAO_SECUNDARIO}>
      Tentar de novo
    </button>
  );
}

interface ListaProps {
  dados: PaginaDeLotes;
  isPlaceholderData: boolean;
  filtros: FiltrosDaVitrine;
  totalPaginas: number;
  aoLimpar: () => void;
  aoIrParaPagina: (pagina: number) => void;
}

function ListaDeLotes({
  dados,
  isPlaceholderData,
  filtros,
  totalPaginas,
  aoLimpar,
  aoIrParaPagina,
}: ListaProps) {
  const { lotes, meta } = dados;
  if (meta.total === 0) {
    return temFiltroDeBusca(filtros) ? (
      <div className="flex flex-col items-start gap-4">
        <p>Nenhum lote encontrado com estes filtros.</p>
        <button type="button" onClick={aoLimpar} className={CLASSE_BOTAO_SECUNDARIO}>
          Limpar filtros
        </button>
      </div>
    ) : (
      <p>{ABAS[filtros.status].vazio}</p>
    );
  }
  return (
    <>
      <p aria-live="polite" className="mb-4 text-sm font-semibold text-texto-suave">
        {textoDoTotal(meta.total)}
      </p>
      <ul aria-busy={isPlaceholderData} className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {lotes.map((lote) => (
          <CartaoDoLote key={lote.id} lote={lote} />
        ))}
      </ul>
      <Paginacao pagina={filtros.pagina} totalPaginas={totalPaginas} aoIr={aoIrParaPagina} />
    </>
  );
}
