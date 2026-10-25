// Encerramento de um lote vencido em UMA transação (specs/010 §Comportamento passo 3, ADR 0032
// D7; tarefa 105). Ordem: travarLoteVencido (FOR UPDATE SKIP LOCKED) → agora(tx), uma vez →
// lances.selar → conferência do selo com o lote travado → com líder: travarCarteiras([vencedor,
// leiloeiro]) → debitarArremate → creditarArremate → recibo → encerrarLote. Lote antes das
// carteiras (specs/004). Qualquer erro desfaz tudo; eventos só depois do COMMIT (aposCommit).
// Outros módulos só pelos index.ts; liquidacao não lê `lots` nem `lot_seals`.
import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { type ColetorDeEventos, aposCommit } from '../../../common/eventos/apos-commit.js';
import { PublicadorDeEventos } from '../../../common/eventos/publicador-de-eventos.js';
import { BANCO } from '../../../config/banco.module.js';
import type { Banco, Transacao } from '../../../db/banco.js';
import { creditarArremate, debitarArremate, travarCarteiras } from '../../carteira/index.js';
import { CadeiaDeLances, LeiturasDeLances, type SeloGravado } from '../../lances/index.js';
import { agora, encerrarLote, type LoteTravado, travarLoteVencido } from '../../lotes/index.js';
import { ErroDeLiquidacao } from './erros.js';
import { emitirRecibo } from './recibos.js';

/** Vencedor público do lote: pseudônimo, valor e o código do comprovante (sem id de usuário). */
export interface VencedorDoLote {
  readonly pseudonimo: string;
  readonly valorCentavos: number;
  readonly codigoComprovante: string;
}

export interface EncerramentoConcluido {
  readonly loteId: string;
  /** null: lote sem lances, encerrado sem vencedor. */
  readonly vencedor: VencedorDoLote | null;
}

/** Lote travado com líder: vencedor, valor e lance arrematado já conferidos com o selo. */
interface Arremate {
  readonly lote: LoteTravado;
  readonly vencedorId: string;
  /** O do selo, igual ao do líder. */
  readonly pseudonimo: string;
  readonly valorCentavos: number;
  readonly lanceId: string;
}

@Injectable()
export class ServicoDeEncerramento {
  readonly #logger = new Logger('Liquidacao');

  constructor(
    @Inject(BANCO) private readonly banco: Banco,
    @Inject(PublicadorDeEventos) private readonly publicador: PublicadorDeEventos,
    @Inject(CadeiaDeLances) private readonly cadeia: CadeiaDeLances,
    @Inject(LeiturasDeLances) private readonly leituras: LeiturasDeLances,
  ) {}

  /**
   * Encerra e liquida o lote, se ainda estiver `ao_vivo` com o fim vencido. `null`, sem efeito,
   * se outra transação o travou, se já foi encerrado ou se o fim foi estendido (idempotente).
   * Erros (ErroDeSelo, ErroDeCarteira, ErroDeLote, ErroDeLiquidacao, banco) seguem para quem
   * chama depois do rollback, sem evento.
   */
  async encerrar(loteId: string): Promise<EncerramentoConcluido | null> {
    try {
      return await aposCommit(this.publicador, (coletor) =>
        this.banco.transaction((tx) => this.naTransacao(tx, coletor, loteId)),
      );
    } catch (erro: unknown) {
      if (erro instanceof ErroDeLiquidacao && erro.codigo === 'SELO_INCOERENTE') {
        // Integridade: só o loteId e o código no log (specs/010 §Conferência).
        this.#logger.error(`${erro.codigo} no encerramento do lote ${erro.loteId}`);
      }
      throw erro;
    }
  }

  private async naTransacao(
    tx: Transacao,
    coletor: ColetorDeEventos,
    loteId: string,
  ): Promise<EncerramentoConcluido | null> {
    // Primeiro comando da tx, como no lance: o FOR UPDATE das carteiras depende disto.
    await tx.execute(sql`set transaction isolation level read committed`);
    const lote = await travarLoteVencido(tx, loteId);
    if (lote === null) return null;
    const instante = await agora(tx);
    const selo = await this.cadeia.selar(tx, {
      loteId: lote.id,
      status: 'encerrado',
      seladoEm: instante,
      lote,
    });
    const arremate = this.conferirSelo(lote, selo);
    if (arremate === null) {
      await encerrarLote(tx, lote.id, {
        vencedorId: null,
        valorArremateCentavos: null,
        encerradoEm: instante,
      });
      coletor.agendar({ tipo: 'lote_encerrado', payload: { loteId: lote.id } });
      return { loteId: lote.id, vencedor: null };
    }
    return this.liquidar(tx, coletor, arremate, selo, instante);
  }

  /**
   * Confere o selo com o lote lido sob o FOR UPDATE (nota da revisão da 112): mesmo total, e o
   * pseudônimo e o valor do líder e do lance atual. Devolve o arremate, ou null sem lances.
   * Divergência → SELO_INCOERENTE (rollback).
   */
  private conferirSelo(lote: LoteTravado, selo: SeloGravado): Arremate | null {
    const incoerente = new ErroDeLiquidacao('SELO_INCOERENTE', lote.id);
    if (selo.status !== 'encerrado' || selo.totalLances !== lote.totalLances) throw incoerente;
    const { liderId, lanceAtualCentavos } = lote;
    if (liderId === null || lanceAtualCentavos === null) {
      const vazio =
        liderId === null &&
        lanceAtualCentavos === null &&
        lote.totalLances === 0 &&
        selo.vencedorPseudonimo === null &&
        selo.valorArremateCentavos === null &&
        selo.ultimoLanceId === null;
      if (!vazio) throw incoerente;
      return null;
    }
    const pseudonimo = this.leituras.seuPseudonimo(lote.id, liderId);
    const lanceId = selo.ultimoLanceId;
    const coerente =
      selo.vencedorPseudonimo === pseudonimo && selo.valorArremateCentavos === lanceAtualCentavos;
    if (!coerente || lanceId === null) throw incoerente;
    return { lote, vencedorId: liderId, pseudonimo, valorCentavos: lanceAtualCentavos, lanceId };
  }

  private async liquidar(
    tx: Transacao,
    coletor: ColetorDeEventos,
    arremate: Arremate,
    selo: SeloGravado,
    instante: Date,
  ): Promise<EncerramentoConcluido> {
    const { lote, vencedorId, pseudonimo, valorCentavos, lanceId } = arremate;
    const referencia = { loteId: lote.id, lanceId };
    // Nota da revisão da 103: as duas carteiras travadas em ordem crescente antes de movimentar;
    // débito e crédito com o MESMO valor, na mesma transação.
    await travarCarteiras(tx, [vencedorId, lote.leiloeiroId]);
    const saldoDoVencedor = await debitarArremate(tx, vencedorId, valorCentavos, referencia);
    const saldoDoLeiloeiro = await creditarArremate(
      tx,
      lote.leiloeiroId,
      valorCentavos,
      referencia,
    );
    const codigoComprovante = await emitirRecibo(tx, {
      loteId: lote.id,
      vencedorId,
      vencedorPseudonimo: pseudonimo,
      valorCentavos,
      hashFinalHex: selo.hashFinal,
      assinaturaSeloBase64url: selo.assinatura,
      keyId: selo.keyId,
      seladoEm: selo.seladoEm,
    });
    await encerrarLote(tx, lote.id, {
      vencedorId,
      valorArremateCentavos: valorCentavos,
      encerradoEm: instante,
    });
    coletor.agendar({
      tipo: 'lote_encerrado',
      payload: {
        loteId: lote.id,
        vencedorPseudonimo: pseudonimo,
        valorArremateCentavos: valorCentavos,
      },
    });
    coletor.agendar({
      tipo: 'lote_arrematado',
      usuarioId: vencedorId,
      payload: { loteId: lote.id, codigoComprovante },
    });
    coletor.agendar({ tipo: 'saldo_atualizado', usuarioId: vencedorId, payload: saldoDoVencedor });
    coletor.agendar({
      tipo: 'saldo_atualizado',
      usuarioId: lote.leiloeiroId,
      payload: saldoDoLeiloeiro,
    });
    return {
      loteId: lote.id,
      vencedor: { pseudonimo, valorCentavos, codigoComprovante },
    };
  }
}
