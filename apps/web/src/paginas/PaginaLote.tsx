import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';

import { ErroDaApi } from '../api/erro';
import { obterLote, type LoteDetalhe } from '../api/lotes';
import { ErroDoServidor } from '../formularios/ErroDoServidor';
import { formatarDataHora } from '../formatacao/data';
import { formatarCentavos } from '../formatacao/dinheiro';
import { tituloDaPagina } from '../layout/site';
import {
  ICONES_DE_STATUS,
  ROTULOS_DE_RARIDADE,
  ROTULOS_DE_STATUS,
  textoDeLances,
} from '../lotes/rotulos';
import { mensagemDoErro } from '../mensagens/erros';

const TITULO_NAO_ENCONTRADO = 'Lote não encontrado';

const VoltarAVitrine = () => (
  <p className="mt-8">
    <Link to="/">Voltar à vitrine</Link>
  </p>
);

function Carta({ lote }: { lote: LoteDetalhe }) {
  const { carta } = lote;
  return (
    <section aria-labelledby="carta-titulo">
      <h2 id="carta-titulo" className="sr-only">
        Carta
      </h2>
      <img
        src={lote.imagemUrl}
        alt={`Carta ${carta.nome}`}
        width={488}
        height={680}
        className="aspect-[488/680] w-full max-w-sm object-contain"
      />
      {carta.artista ? <p className="mt-2 text-texto-suave">Ilustração: {carta.artista}</p> : null}
      <ul className="mt-4 flex flex-col gap-1">
        <li>Carta: {carta.nome}</li>
        <li>Coleção: {carta.colecao}</li>
        <li>Raridade: {ROTULOS_DE_RARIDADE[carta.raridade]}</li>
        <li>Tipo: {carta.tipo}</li>
      </ul>
      {carta.textoOracle ? <p className="mt-2">{carta.textoOracle}</p> : null}
    </section>
  );
}

function Dados({ lote }: { lote: LoteDetalhe }) {
  return (
    <section aria-labelledby="lote-titulo" className="flex flex-col gap-2">
      <h2 id="lote-titulo" className="sr-only">
        Dados do lote
      </h2>
      <p className="font-bold">
        <span aria-hidden="true">{ICONES_DE_STATUS[lote.status]}</span>{' '}
        {ROTULOS_DE_STATUS[lote.status]}
      </p>
      {lote.status === 'cancelado' ? <p role="status">Este lote foi cancelado.</p> : null}
      {lote.suaPosicao === 'ganhando' ? <p>Você está ganhando este lote.</p> : null}
      {lote.suaPosicao === 'venceu' ? <p>Você venceu este lote.</p> : null}
      {lote.descricao ? (
        <>
          <h3 className="font-bold">Descrição</h3>
          <p>{lote.descricao}</p>
        </>
      ) : null}
      <p>Lance inicial: {formatarCentavos(lote.lanceInicialCentavos)}</p>
      <p>Incremento mínimo: {formatarCentavos(lote.incrementoMinimoCentavos)}</p>
      <p>
        {lote.lanceAtualCentavos === null
          ? 'Nenhum lance ainda.'
          : `Lance atual: ${formatarCentavos(lote.lanceAtualCentavos)}`}
      </p>
      <p>{textoDeLances(lote.totalLances)}</p>
      <p>Início: {formatarDataHora(lote.inicioEm)}</p>
      <p>Fim: {formatarDataHora(lote.fimEm)}</p>
      {lote.fimOriginalEm === lote.fimEm ? null : (
        <p>Fim original: {formatarDataHora(lote.fimOriginalEm)}</p>
      )}
    </section>
  );
}

export function PaginaLote() {
  const { id = '' } = useParams();
  const consulta = useQuery({
    queryKey: ['lotes', 'detalhe', id],
    queryFn: () => obterLote(id),
    retry: false,
  });

  if (consulta.error) {
    if (consulta.error instanceof ErroDaApi && consulta.error.status === 404) {
      return (
        <>
          <title>{tituloDaPagina(TITULO_NAO_ENCONTRADO)}</title>
          <h1 className="text-3xl font-bold tracking-tight">{TITULO_NAO_ENCONTRADO}</h1>
          <p className="mt-4">{mensagemDoErro('NAO_ENCONTRADO')}</p>
          <VoltarAVitrine />
        </>
      );
    }
    return (
      <>
        <title>{tituloDaPagina('Lote')}</title>
        <h1 className="text-3xl font-bold tracking-tight">Lote</h1>
        <div className="mt-4 flex flex-col items-start gap-4">
          <ErroDoServidor erro={consulta.error} />
          <button
            type="button"
            onClick={() => void consulta.refetch()}
            className="min-h-11 rounded-md border border-borda-controle px-4 font-medium"
          >
            Tentar de novo
          </button>
        </div>
        <VoltarAVitrine />
      </>
    );
  }

  if (!consulta.data) {
    return (
      <>
        <title>{tituloDaPagina('Lote')}</title>
        <p role="status">Carregando lote…</p>
      </>
    );
  }

  const lote = consulta.data;
  return (
    <>
      <title>{tituloDaPagina(lote.titulo)}</title>
      <h1 className="text-3xl font-bold tracking-tight">{lote.titulo}</h1>
      <div className="mt-6 grid gap-8 md:grid-cols-2">
        <Carta lote={lote} />
        <Dados lote={lote} />
      </div>
      <VoltarAVitrine />
    </>
  );
}
