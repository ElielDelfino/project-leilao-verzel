import type { ReactNode } from 'react';
import { Link } from 'react-router';

import type { LoteDetalhe, StatusLote } from '../api/lotes';
import { formatarDataHora } from '../formatacao/data';
import { formatarCentavos } from '../formatacao/dinheiro';
import { ICONES_DE_STATUS, ROTULOS_DE_STATUS, textoDeLances } from '../lotes/rotulos';
import { Carta } from './Carta';
import { Contagem } from './Contagem';
import { AreaDeLance } from './FormularioDeLance';
import type { EstadoDaSala } from './estadoDaSala';
import { HistoricoDeLances } from './HistoricoDeLances';
import { IndicadorDePosicao } from './IndicadorDePosicao';

/** Selo de status da sala: cor + ícone + texto (cor nunca é o único sinal). */
const COR_DO_STATUS: Record<StatusLote, string> = {
  ao_vivo: 'bg-sucesso text-fundo',
  agendado: 'bg-aviso text-fundo',
  encerrado: 'bg-perigo text-fundo',
  cancelado: 'bg-texto-suave text-fundo',
};

/** Peça "rótulo: valor" do painel de dados do lote; o texto continua numa linha só. */
const CLASSE_DADO = 'rounded-xl border border-borda bg-poco px-4 py-3 text-sm font-semibold';

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
    <section
      aria-labelledby="lote-titulo"
      className="cartao flex flex-col gap-4 self-start p-5 sm:p-6"
    >
      <h2 id="lote-titulo" className="sr-only">
        Dados do lote
      </h2>
      {detalhe.descricao ? <p className="text-texto-suave">{detalhe.descricao}</p> : null}
      <div className="flex flex-col items-start gap-4">{semEstado}</div>
    </section>
  );
}

function LinkDaAuditoria({ loteId }: { loteId: string }) {
  return (
    <p>
      <Link to={`/auditoria/${loteId}`} className="botao-secundario">
        Ver auditoria
      </Link>
    </p>
  );
}

function Situacao({ sala }: { sala: EstadoDaSala }) {
  const { lote, suaPosicao } = sala;
  if (lote.status === 'cancelado') {
    return (
      <>
        <p role="status" className="aviso">
          Este lote foi cancelado.
        </p>
        <LinkDaAuditoria loteId={lote.id} />
      </>
    );
  }
  if (lote.status === 'agendado') {
    return (
      <p className="rounded-xl border border-aviso bg-aviso/10 p-3 font-semibold text-aviso">
        Este lote ainda não começou. Abre em {formatarDataHora(lote.inicioEm)}.
      </p>
    );
  }
  if (lote.status === 'encerrado') {
    return (
      <>
        <div
          role="status"
          className="flex flex-col gap-1 rounded-xl border border-borda bg-poco p-4"
        >
          <p className="font-semibold">Este lote foi encerrado.</p>
          {lote.valorArremateCentavos === null ? null : (
            <p className="text-lg font-extrabold text-destaque">
              Arrematado por {formatarCentavos(lote.valorArremateCentavos)}.
            </p>
          )}
          {suaPosicao === 'venceu' ? (
            <p className="font-semibold text-sucesso">Você venceu este lote.</p>
          ) : null}
          {suaPosicao === 'perdeu' ? (
            <p className="font-semibold text-texto-suave">Você não venceu este lote.</p>
          ) : null}
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
      <section aria-labelledby="lote-titulo" className="flex flex-col gap-5">
        <h2 id="lote-titulo" className="sr-only">
          Dados do lote
        </h2>
        <div className="cartao flex flex-col gap-4 p-5 sm:p-6">
          <p className={`selo self-start ${COR_DO_STATUS[lote.status]}`}>
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
          {aoVivo ? null : (
            <p className="text-sm text-texto-suave">Fim: {formatarDataHora(lote.fimEm)}</p>
          )}
          {sala.avisoFimEstendido ? (
            <p role="status" className="text-sm font-semibold text-aviso">
              {sala.avisoFimEstendido}
            </p>
          ) : null}
          <Situacao sala={sala} />
          {mostrarPosicao ? (
            <IndicadorDePosicao
              posicao={sala.suaPosicao}
              lanceAtualCentavos={lote.lanceAtualCentavos}
            />
          ) : null}
          <AreaDeLance lote={lote} aoSincronizar={aoSincronizar} reconectando={reconectando} />
        </div>

        <div className="cartao flex flex-col gap-4 p-5 sm:p-6">
          {detalhe.descricao ? <p className="text-texto-suave">{detalhe.descricao}</p> : null}
          <p className="rounded-xl bg-destaque/10 px-4 py-3 text-lg font-extrabold text-destaque">
            {lote.lanceAtualCentavos === null
              ? 'Nenhum lance ainda.'
              : `Lance atual: ${formatarCentavos(lote.lanceAtualCentavos)}`}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <p className={CLASSE_DADO}>
              Lance inicial: {formatarCentavos(lote.lanceInicialCentavos)}
            </p>
            <p className={CLASSE_DADO}>
              Incremento mínimo: {formatarCentavos(lote.incrementoMinimoCentavos)}
            </p>
            <p className={CLASSE_DADO}>{textoDeLances(lote.totalLances)}</p>
            <p className={CLASSE_DADO}>Início: {formatarDataHora(lote.inicioEm)}</p>
            {lote.fimOriginalEm === lote.fimEm ? null : (
              <p className={CLASSE_DADO}>Fim original: {formatarDataHora(lote.fimOriginalEm)}</p>
            )}
          </div>
        </div>

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
 * A `<Carta>` fica sempre na mesma posição da árvore, com e sem `sala`: assim a imagem não é
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
      <div className="relative overflow-hidden rounded-3xl border border-borda bg-linear-to-br from-primario/15 via-superficie to-poco px-6 py-6 sm:px-8">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-20 -right-20 size-60 rounded-full bg-primario/20 blur-3xl"
        />
        <h1 className="relative text-2xl font-extrabold tracking-tight sm:text-3xl">
          {detalhe.titulo}
        </h1>
        {sala && reconectando ? (
          <p role="status" className="relative mt-2 text-sm font-semibold text-aviso">
            Reconectando…
          </p>
        ) : null}
      </div>
      <div className="mt-6 grid gap-6 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
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
