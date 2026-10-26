import type { EventosDoServidor } from '@leilao/contracts';

import { formatarDataHora } from '../formatacao/data';
import { formatarCentavos } from '../formatacao/dinheiro';
import type {
  EstadoDoServidor,
  LanceDoHistorico,
  LoteDoEstado,
  PosicaoNoLote,
} from './tiposDoServidor';

export type { LanceDoHistorico, PosicaoNoLote };

/** Tamanho do histórico exibido (specs/012 §Relógio, histórico). */
export const MAXIMO_DE_LANCES = 50;

/** Estado local da sala; só funções puras o transformam (specs/009 e specs/012 §Sala). */
export interface EstadoDaSala {
  readonly lote: LoteDoEstado;
  /** Do mais recente ao mais antigo. */
  readonly lances: readonly LanceDoHistorico[];
  readonly seuPseudonimo: string | undefined;
  readonly suaPosicao: PosicaoNoLote | undefined;
  /** `agoraServidor` menos o relógio local no instante em que o estado chegou. */
  readonly deslocamentoMs: number;
  /** Texto do `aria-live="polite"`. */
  readonly anuncioCortes: string;
  /** Texto do `aria-live="assertive"`. */
  readonly anuncioSuperado: string;
  /** "O fim do lote foi estendido para …", ou vazio. */
  readonly avisoFimEstendido: string;
  /**
   * Maior `fimEm` já anunciado por um `fim_estendido` (ou o `fimEm` do estado do servidor, que já
   * reflete as extensões anteriores). Invariante: só cresce e é independente de `lote.fimEm`.
   * O servidor publica `lance_aceito` (com o `fimEm` novo) antes de `fim_estendido`, e a ordem
   * entre eventos não é garantida; por isso `lance_aceito` move `lote.fimEm` mas nunca este
   * campo, e `fim_estendido` é novo se, e só se, o seu `fimEm` passa dele.
   */
  readonly fimAnunciadoEm: string;
}

/** Substitui todo o estado local pelo do servidor (entrada na sala e resync). */
export function criarEstadoDaSala(estado: EstadoDoServidor, relogioLocalMs: number): EstadoDaSala {
  return {
    lote: estado.lote,
    lances: estado.ultimosLances.slice(0, MAXIMO_DE_LANCES),
    seuPseudonimo: estado.seuPseudonimo,
    suaPosicao: estado.suaPosicao,
    deslocamentoMs: Date.parse(estado.agoraServidor) - relogioLocalMs,
    anuncioCortes: '',
    anuncioSuperado: '',
    avisoFimEstendido: '',
    fimAnunciadoEm: estado.lote.fimEm,
  };
}

export function textoSuperado(valorCentavos: number): string {
  return `Você foi superado. O lance atual é ${formatarCentavos(valorCentavos)}.`;
}

/** `encerrado` e `cancelado` não voltam atrás: evento atrasado nunca reverte esses estados. */
function ehTerminal(estado: EstadoDaSala): boolean {
  return estado.lote.status === 'encerrado' || estado.lote.status === 'cancelado';
}

/** O fim do lote só cresce (anti-sniping); um `fimEm` menor ou igual é evento atrasado. */
function maiorFim(atual: string, recebido: string): string {
  return Date.parse(recebido) > Date.parse(atual) ? recebido : atual;
}

/**
 * `lance_aceito` com `seq` acima do último + 1: algum evento se perdeu (specs/009). Sem lances,
 * o último é 0. Sala terminal não ressincroniza por isso.
 */
export function haLacunaDeSeq(
  estado: EstadoDaSala,
  evento: EventosDoServidor['lance_aceito'],
): boolean {
  if (ehTerminal(estado)) return false;
  return evento.seq > (estado.lances[0]?.seq ?? 0) + 1;
}

export interface ResyncMesclado {
  readonly estado: EstadoDaSala;
  /** O resync trouxe um `fimEm` ainda não anunciado: a sala deve mostrar o selo. */
  readonly novaExtensao: boolean;
}

/**
 * Estado do resync sobre o anterior (specs/012 §Extensão vista só no resync). O servidor manda no
 * estado, mas o aviso de fim estendido é preservado; um `fimEm` além do já anunciado é anunciado
 * uma vez. Sem estado anterior (primeira entrada) nunca anuncia.
 */
export function mesclarResync(
  anterior: EstadoDaSala | null,
  recebido: EstadoDaSala,
): ResyncMesclado {
  if (!anterior) return { estado: recebido, novaExtensao: false };
  if (Date.parse(recebido.lote.fimEm) > Date.parse(anterior.fimAnunciadoEm)) {
    return {
      estado: {
        ...recebido,
        avisoFimEstendido: `O fim do lote foi estendido para ${formatarDataHora(recebido.lote.fimEm)}.`,
      },
      novaExtensao: true,
    };
  }
  return {
    estado: {
      ...recebido,
      avisoFimEstendido: anterior.avisoFimEstendido,
      fimAnunciadoEm: anterior.fimAnunciadoEm,
    },
    novaExtensao: false,
  };
}

export function aplicarLance(
  estado: EstadoDaSala,
  evento: EventosDoServidor['lance_aceito'],
): EstadoDaSala {
  if (ehTerminal(estado)) return estado;
  if (haLacunaDeSeq(estado, evento)) return estado;
  const maisRecente = estado.lances[0];
  // Evento atrasado ou repetido (já refletido no estado do resync): ignora.
  if (maisRecente && evento.seq <= maisRecente.seq) return estado;
  if (evento.totalLances < estado.lote.totalLances) return estado;

  const meu = estado.seuPseudonimo !== undefined && evento.pseudonimo === estado.seuPseudonimo;
  const superado = !meu && estado.suaPosicao === 'ganhando';
  const novoLance: LanceDoHistorico = {
    seq: evento.seq,
    pseudonimo: evento.pseudonimo,
    valorCentavos: evento.valorCentavos,
    criadoEm: evento.criadoEm,
  };
  let suaPosicao = estado.suaPosicao;
  if (meu) suaPosicao = 'ganhando';
  else if (superado) suaPosicao = 'superado';

  return {
    ...estado,
    lote: {
      ...estado.lote,
      lanceAtualCentavos: evento.valorCentavos,
      totalLances: evento.totalLances,
      fimEm: maiorFim(estado.lote.fimEm, evento.fimEm),
    },
    lances: [novoLance, ...estado.lances].slice(0, MAXIMO_DE_LANCES),
    suaPosicao,
    anuncioCortes: meu
      ? estado.anuncioCortes
      : `Novo lance de ${formatarCentavos(evento.valorCentavos)} por ${evento.pseudonimo}.`,
    anuncioSuperado: superado ? textoSuperado(evento.valorCentavos) : estado.anuncioSuperado,
  };
}

export function aplicarFimEstendido(
  estado: EstadoDaSala,
  evento: EventosDoServidor['fim_estendido'],
): EstadoDaSala {
  if (ehTerminal(estado)) return estado;
  // Repetido (resync, reconexão) ou atrasado: já anunciado, não pisca o aviso de novo.
  if (Date.parse(evento.fimEm) <= Date.parse(estado.fimAnunciadoEm)) return estado;
  // O `lance_aceito` pode já ter gravado este fim (ou um maior): o fim exibido nunca recua.
  const fimEm = maiorFim(estado.lote.fimEm, evento.fimEm);
  return {
    ...estado,
    lote: fimEm === estado.lote.fimEm ? estado.lote : { ...estado.lote, fimEm },
    avisoFimEstendido: `O fim do lote foi estendido para ${formatarDataHora(fimEm)}.`,
    fimAnunciadoEm: evento.fimEm,
  };
}

export function aplicarSuperado(
  estado: EstadoDaSala,
  evento: EventosDoServidor['voce_foi_superado'],
): EstadoDaSala {
  if (ehTerminal(estado)) return estado;
  return {
    ...estado,
    suaPosicao: 'superado',
    anuncioSuperado: textoSuperado(evento.valorCentavos),
  };
}

export function aplicarIniciado(estado: EstadoDaSala): EstadoDaSala {
  if (ehTerminal(estado)) return estado;
  return { ...estado, lote: { ...estado.lote, status: 'ao_vivo' } };
}

export function aplicarCancelado(estado: EstadoDaSala): EstadoDaSala {
  if (ehTerminal(estado)) return estado;
  return { ...estado, lote: { ...estado.lote, status: 'cancelado' } };
}

export function aplicarEncerrado(
  estado: EstadoDaSala,
  evento: EventosDoServidor['lote_encerrado'],
): EstadoDaSala {
  const participava = estado.suaPosicao === 'ganhando' || estado.suaPosicao === 'superado';
  const venceu =
    evento.vencedorPseudonimo !== undefined && evento.vencedorPseudonimo === estado.seuPseudonimo;
  let suaPosicao = estado.suaPosicao;
  if (participava) suaPosicao = venceu ? 'venceu' : 'perdeu';
  return {
    ...estado,
    lote: {
      ...estado.lote,
      status: 'encerrado',
      valorArremateCentavos: evento.valorArremateCentavos ?? estado.lote.valorArremateCentavos,
    },
    suaPosicao,
  };
}
