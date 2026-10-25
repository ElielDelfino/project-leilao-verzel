// Estado da sala devolvido no ack de `entrar_lote` (specs/009 §Ack de `entrar_lote`; asyncapi
// 0.3.0, schema `Estado`). Montado só pelas interfaces públicas de `lotes` (resumo e relógio do
// Postgres) e `lances` (últimos lances, posição e pseudônimo). Nunca leva nome, e-mail nem id de
// usuário: o resumo traz `liderId` e `vencedorId`, que são descartados campo a campo aqui.
import { Inject, Injectable } from '@nestjs/common';

import { BANCO } from '../../config/banco.module.js';
import type { Banco } from '../../db/banco.js';
import { type LancePublico, LeiturasDeLances, type PosicaoDoUsuario } from '../lances/index.js';
import { agora, obterResumos, type ResumoDoLote, type StatusDoLote } from '../lotes/index.js';

/** Quantos lances vão no estado (specs/009: até 50). */
export const LANCES_NO_ESTADO = 50;

/** Schema `LoteDoEstado` do asyncapi. */
export interface LoteDoEstado {
  readonly id: string;
  readonly status: StatusDoLote;
  readonly inicioEm: string;
  readonly fimEm: string;
  readonly fimOriginalEm: string;
  readonly lanceInicialCentavos: number;
  readonly incrementoMinimoCentavos: number;
  readonly lanceAtualCentavos: number | null;
  readonly totalLances: number;
  readonly valorArremateCentavos: number | null;
}

/** Schema `Estado` do asyncapi; `seuPseudonimo` e `suaPosicao` só para autenticado (D8). */
export interface EstadoDaSala {
  readonly lote: LoteDoEstado;
  readonly ultimosLances: readonly LancePublico[];
  readonly agoraServidor: string;
  readonly seuPseudonimo?: string;
  readonly suaPosicao?: PosicaoDoUsuario;
}

/** Campo a campo, de propósito: nada do resumo que identifique usuário chega ao estado. */
export function paraLoteDoEstado(resumo: ResumoDoLote): LoteDoEstado {
  return {
    id: resumo.id,
    status: resumo.status,
    inicioEm: resumo.inicioEm.toISOString(),
    fimEm: resumo.fimEm.toISOString(),
    fimOriginalEm: resumo.fimOriginalEm.toISOString(),
    lanceInicialCentavos: resumo.lanceInicialCentavos,
    incrementoMinimoCentavos: resumo.incrementoMinimoCentavos,
    lanceAtualCentavos: resumo.lanceAtualCentavos,
    totalLances: resumo.totalLances,
    valorArremateCentavos: resumo.valorArremateCentavos,
  };
}

@Injectable()
export class MontadorDoEstado {
  constructor(
    @Inject(BANCO) private readonly banco: Banco,
    @Inject(LeiturasDeLances) private readonly leituras: LeiturasDeLances,
  ) {}

  /**
   * Estado atual do lote, ou `null` se ele não existir. `loteId` já validado como UUID (em
   * minúsculas). O lote e `agoraServidor` saem da mesma transação de leitura: o status derivado
   * usa o `now()` dela e o relógio é o `clock_timestamp()` do Postgres, o mesmo do lance.
   */
  async montar(loteId: string, usuarioId: string | undefined): Promise<EstadoDaSala | null> {
    const lido = await this.banco.transaction(async (tx) => {
      const [resumo] = await obterResumos(tx, [loteId]);
      if (resumo === undefined) return null;
      return { resumo, instante: await agora(tx) };
    });
    if (lido === null) return null;
    const ultimosLances = await this.leituras.ultimosLances(loteId, LANCES_NO_ESTADO);
    const base: EstadoDaSala = {
      lote: paraLoteDoEstado(lido.resumo),
      ultimosLances,
      agoraServidor: lido.instante.toISOString(),
    };
    if (usuarioId === undefined) return base;
    const suaPosicao = await this.leituras.posicaoDoUsuario(loteId, usuarioId);
    return { ...base, seuPseudonimo: this.leituras.seuPseudonimo(loteId, usuarioId), suaPosicao };
  }
}
