import type { ReactNode } from 'react';
import { Link } from 'react-router';

import type { LoteDetalhe } from '../api/lotes';
import { formatarDataHora } from '../formatacao/data';
import { formatarCentavos } from '../formatacao/dinheiro';
import { ICONES_DE_STATUS, ROTULOS_DE_STATUS, textoDeLances } from '../lotes/rotulos';
import { Carta } from './Carta';
import { Contagem } from './Contagem';
import { AreaDeLance } from './FormularioDeLance';
import type { EstadoDaSala } from './estadoDaSala';
import { HistoricoDeLances } from './HistoricoDeLances';
import { IndicadorDePosicao } from './IndicadorDePosicao';

interface Props {
  detalhe: LoteDetalhe;
  /** `null` enquanto o estado da sala não chegou: o detalhe estático aparece mesmo assim. */
  sala: EstadoDaSala | null;
  reconectando: boolean;
  seloDeFimEstendido: boolean;
  /** Mostrado no lugar da parte ao vivo enquanto não há `sala` (carregando ou erro de entrada). */
  semEstado?: ReactNode;
  aoSincronizar: () => void;
}

function PainelSemEstado({ detalhe, semEstado }: { detalhe: LoteDetalhe; semEstado: ReactNode }) {
  return (
    <section aria-labelledby="lote-titulo" className="flex flex-col gap-3">
      <h2 id="lote-titulo" className="sr-only">
        Dados do lote
      </h2>
      {detalhe.descricao ? <p>{detalhe.descricao}</p> : null}
      <div className="flex flex-col items-start gap-4">{semEstado}</div>
    </section>
  );
}

function LinkDaAuditoria({ loteId }: { loteId: string }) {
  return (
    <p>
      <Link to={`/auditoria/${loteId}`}>Ver auditoria</Link>
    </p>
  );
}

function Situacao({ sala }: { sala: EstadoDaSala }) {
  const { lote, suaPosicao } = sala;
  if (lote.status === 'cancelado') {
    return (
      <>
        <p role="status">Este lote foi cancelado.</p>
        <LinkDaAuditoria loteId={lote.id} />
      </>
    );
  }
  if (lote.status === 'agendado') {
    return <p>Este lote ainda não começou. Abre em {formatarDataHora(lote.inicioEm)}.</p>;
  }
  if (lote.status === 'encerrado') {
    return (
      <>
        <div role="status" className="flex flex-col gap-1">
          <p>Este lote foi encerrado.</p>
          {lote.valorArremateCentavos === null ? null : (
            <p>Arrematado por {formatarCentavos(lote.valorArremateCentavos)}.</p>
          )}
          {suaPosicao === 'venceu' ? <p>Você venceu este lote.</p> : null}
          {suaPosicao === 'perdeu' ? <p>Você não venceu este lote.</p> : null}
        </div>
        <LinkDaAuditoria loteId={lote.id} />
      </>
    );
  }
  return null;
}

interface PainelProps {
  detalhe: LoteDetalhe;
  sala: EstadoDaSala;
  reconectando: boolean;
  seloDeFimEstendido: boolean;
  aoSincronizar: () => void;
}

function PainelAoVivo({
  detalhe,
  sala,
  reconectando,
  seloDeFimEstendido,
  aoSincronizar,
}: PainelProps) {
  const { lote } = sala;
  const aoVivo = lote.status === 'ao_vivo';
  const textoSemLances = aoVivo
    ? `Nenhum lance ainda. O primeiro lance deve ser de pelo menos ${formatarCentavos(lote.lanceInicialCentavos)}.`
    : 'Nenhum lance.';
  const mostrarPosicao = aoVivo && sala.suaPosicao !== undefined;

  return (
    <>
      <section aria-labelledby="lote-titulo" className="flex flex-col gap-3">
        <h2 id="lote-titulo" className="sr-only">
          Dados do lote
        </h2>
        <p className="font-bold">
          <span aria-hidden="true">{ICONES_DE_STATUS[lote.status]}</span>{' '}
          {ROTULOS_DE_STATUS[lote.status]}
        </p>
        {aoVivo ? (
          <Contagem
            fimEm={lote.fimEm}
            deslocamentoMs={sala.deslocamentoMs}
            fimEstendido={seloDeFimEstendido}
          />
        ) : null}
        {aoVivo ? null : <p>Fim: {formatarDataHora(lote.fimEm)}</p>}
        {sala.avisoFimEstendido ? <p role="status">{sala.avisoFimEstendido}</p> : null}
        <Situacao sala={sala} />
        {mostrarPosicao ? (
          <IndicadorDePosicao
            posicao={sala.suaPosicao}
            lanceAtualCentavos={lote.lanceAtualCentavos}
          />
        ) : null}
        <AreaDeLance lote={lote} aoSincronizar={aoSincronizar} reconectando={reconectando} />
        {detalhe.descricao ? <p>{detalhe.descricao}</p> : null}
        <p>Lance inicial: {formatarCentavos(lote.lanceInicialCentavos)}</p>
        <p>Incremento mínimo: {formatarCentavos(lote.incrementoMinimoCentavos)}</p>
        <p>
          {lote.lanceAtualCentavos === null
            ? 'Nenhum lance ainda.'
            : `Lance atual: ${formatarCentavos(lote.lanceAtualCentavos)}`}
        </p>
        <p>{textoDeLances(lote.totalLances)}</p>
        <p>Início: {formatarDataHora(lote.inicioEm)}</p>
        {lote.fimOriginalEm === lote.fimEm ? null : (
          <p>Fim original: {formatarDataHora(lote.fimOriginalEm)}</p>
        )}
        <HistoricoDeLances
          lances={sala.lances}
          seuPseudonimo={sala.seuPseudonimo}
          textoSemLances={textoSemLances}
        />
      </section>
    </>
  );
}

function AnunciosDaSala({ sala }: { sala: EstadoDaSala }) {
  return (
    <>
      <div aria-live="polite" className="sr-only">
        {sala.anuncioCortes}
      </div>
      <div role="alert" aria-live="assertive" className="sr-only">
        {sala.anuncioSuperado}
      </div>
    </>
  );
}

/**
 * A `<Carta>` fica sempre na mesma posição da árvore, com e sem `sala`: assim a `<img>` não é
 * desmontada (nem recarregada) quando o estado chega. Só o painel ao vivo alterna.
 */
export function Sala({
  detalhe,
  sala,
  reconectando,
  seloDeFimEstendido,
  semEstado,
  aoSincronizar,
}: Props) {
  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight">{detalhe.titulo}</h1>
      {sala && reconectando ? <p role="status">Reconectando…</p> : null}
      <div className="mt-6 grid gap-8 md:grid-cols-2">
        <Carta lote={detalhe} />
        {sala ? (
          <PainelAoVivo
            detalhe={detalhe}
            sala={sala}
            reconectando={reconectando}
            seloDeFimEstendido={seloDeFimEstendido}
            aoSincronizar={aoSincronizar}
          />
        ) : (
          <PainelSemEstado detalhe={detalhe} semEstado={semEstado} />
        )}
      </div>
      {sala ? <AnunciosDaSala sala={sala} /> : null}
    </>
  );
}
