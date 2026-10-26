// Cancelamento de lote com estorno em UMA transação (specs/010 §Cancelamento, ADR 0025 e 0032;
// tarefa 106). Locks na ordem lote → carteira (specs/004). `lock_timeout` de 5 s e
// `statement_timeout` de 10 s só nesta transação. Qualquer erro desfaz tudo; os eventos saem só
// depois do COMMIT (aposCommit) e a resposta é lida por `obterResumos` depois dele.
// Outros módulos só pelos index.ts; liquidacao não lê `lots`, `bids`, `lot_seals` nem o ledger.
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { SchemasApi } from '@leilao/contracts';
import { sql } from 'drizzle-orm';

import { type ColetorDeEventos, aposCommit } from '../../../common/eventos/apos-commit.js';
import { PublicadorDeEventos } from '../../../common/eventos/publicador-de-eventos.js';
import { BANCO } from '../../../config/banco.module.js';
import type { Banco, Transacao } from '../../../db/banco.js';
import { estornar, type SaldoComDisponivel, travarCarteiras } from '../../carteira/index.js';
import { CadeiaDeLances, type SeloGravado } from '../../lances/index.js';
import {
  agora,
  cancelarLote,
  type LoteTravado,
  obterResumos,
  travarLote,
} from '../../lotes/index.js';
import {
  loteEncerrado,
  loteNaoEncontrado,
  paraLote,
  traduzirFalhaDoCancelamento,
} from './falhas.js';

/** Espera máxima pelo lock do lote ou da carteira, só nesta transação (specs/010). */
export const LOCK_TIMEOUT_DO_CANCELAMENTO_MS = 5_000;
/** Duração máxima de cada consulta, só nesta transação (specs/010). */
export const STATEMENT_TIMEOUT_DO_CANCELAMENTO_MS = 10_000;

/** Líder estornado e o saldo dele lido na transação, para o `saldo_atualizado`. */
interface EstornoDoLider {
  readonly liderId: string;
  readonly saldo: SaldoComDisponivel;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class ServicoDeCancelamento {
  readonly #logger = new Logger('Liquidacao');

  constructor(
    @Inject(BANCO) private readonly banco: Banco,
    @Inject(PublicadorDeEventos) private readonly publicador: PublicadorDeEventos,
    @Inject(CadeiaDeLances) private readonly cadeia: CadeiaDeLances,
  ) {}

  /** Cancela o lote do leiloeiro e devolve o `Lote` (status `cancelado`) lido depois do COMMIT. */
  async cancelar(leiloeiroId: string, idDoLote: string): Promise<SchemasApi['Lote']> {
    if (!UUID.test(idDoLote)) throw loteNaoEncontrado();
    const loteId = idDoLote.toLowerCase();
    try {
      await aposCommit(this.publicador, (coletor) =>
        this.banco.transaction((tx) => this.naTransacao(tx, coletor, leiloeiroId, loteId)),
      );
    } catch (erro: unknown) {
      throw this.traduzirFalha(erro, loteId);
    }
    const [resumo] = await this.banco.consultar((db) => obterResumos(db, [loteId]));
    if (resumo === undefined) throw new Error('lote cancelado sumiu depois do COMMIT');
    return paraLote(resumo);
  }

  private async naTransacao(
    tx: Transacao,
    coletor: ColetorDeEventos,
    leiloeiroId: string,
    loteId: string,
  ): Promise<void> {
    // Primeiro comando da tx, como no lance e no encerramento: o FOR UPDATE da carteira depende.
    await tx.execute(sql`set transaction isolation level read committed`);
    // set_config(..., true) é o SET LOCAL: some no COMMIT ou ROLLBACK, sem vazar para o pool.
    await tx.execute(
      sql`select set_config('lock_timeout', ${String(LOCK_TIMEOUT_DO_CANCELAMENTO_MS)}, true),
                 set_config('statement_timeout', ${String(STATEMENT_TIMEOUT_DO_CANCELAMENTO_MS)}, true)`,
    );
    const lote = await travarLote(tx, loteId);
    if (lote === null || lote.leiloeiroId !== leiloeiroId) throw loteNaoEncontrado();
    if (lote.status === 'encerrado' || lote.status === 'cancelado') throw loteEncerrado();
    const instante = await agora(tx);
    if (instante.getTime() >= lote.fimEm.getTime()) throw loteEncerrado();
    // DESVIO da ordem da specs/010 (estorno antes do selo), pendente de decisão: o `lance_id` do
    // estorno só sai de `selar` (`ultimoLanceId`); a interface de `lances` não expõe o último
    // lance na `tx`. Mesma transação e mesma ordem de locks (lote → carteira).
    const selo = await this.cadeia.selar(tx, {
      loteId,
      status: 'cancelado',
      seladoEm: instante,
      lote,
    });
    const estorno = await this.estornarLider(tx, lote, selo);
    await cancelarLote(tx, loteId, instante);
    coletor.agendar({ tipo: 'lote_cancelado', payload: { loteId } });
    if (estorno !== null) {
      coletor.agendar({
        tipo: 'saldo_atualizado',
        usuarioId: estorno.liderId,
        payload: estorno.saldo,
      });
    }
  }

  /**
   * Com líder: trava a carteira dele e estorna o `compromisso` lido sob o lock do lote
   * (`lance_atual_centavos`), nunca um valor do cliente, com o lance do líder (o último da cadeia,
   * devolvido por `selar`) no lançamento. Sem líder (agendado ou sem lances): null, sem estorno.
   */
  private async estornarLider(
    tx: Transacao,
    lote: LoteTravado,
    selo: SeloGravado,
  ): Promise<EstornoDoLider | null> {
    const { liderId, lanceAtualCentavos } = lote;
    if (liderId === null) {
      if (selo.ultimoLanceId !== null || selo.totalLances !== 0) {
        throw new Error('selo com lances em lote sem líder');
      }
      return null;
    }
    if (lanceAtualCentavos === null || selo.ultimoLanceId === null) {
      throw new Error('lote com líder sem lance atual ou sem lance na cadeia');
    }
    await travarCarteiras(tx, [liderId]);
    const saldo = await estornar(tx, liderId, lanceAtualCentavos, {
      loteId: lote.id,
      lanceId: selo.ultimoLanceId,
    });
    return { liderId, saldo };
  }

  /** Só o loteId e o nome/código no log: nunca valores, ids de usuário nem a mensagem do driver. */
  private traduzirFalha(erro: unknown, loteId: string): unknown {
    const traduzido = traduzirFalhaDoCancelamento(erro);
    if (traduzido !== erro) {
      const codigo = (erro as { codigo?: unknown }).codigo;
      this.#logger.warn(`cancelamento do lote ${loteId} não aplicado (${String(codigo)})`);
    }
    return traduzido;
  }
}
