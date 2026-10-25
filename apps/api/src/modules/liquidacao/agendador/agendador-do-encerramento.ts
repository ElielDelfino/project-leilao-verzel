// Agendador de 1 s (specs/010 §Comportamento, tarefa 107): a cada tick inicia os lotes agendados
// cujo início chegou e encerra, um a um, os candidatos vencidos. Liga e desliga só por `iniciar()`
// e `parar()` explícitos (o main.ts); por isso o intervalo é registrado no SchedulerRegistry do
// @nestjs/schedule em vez de `@Interval`, que ligaria sozinho no bootstrap, inclusive nos testes.
//
// Log: só `name`, `codigo` e `loteId`. Nunca `cause`, `String(erro)` nem o objeto: o `cause` do
// driver leva SQL, vencedor_id, valor e hash (notas da revisão da 105).
import { Inject, Injectable, Logger } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';

import { aposCommit } from '../../../common/eventos/apos-commit.js';
import { PublicadorDeEventos } from '../../../common/eventos/publicador-de-eventos.js';
import { BANCO } from '../../../config/banco.module.js';
import type { Banco } from '../../../db/banco.js';
import { candidatosAoEncerramento, iniciarLotesPendentes } from '../../lotes/index.js';
import { ServicoDeEncerramento } from '../encerramento/servico-de-encerramento.js';
import { BackoffDeLotes } from './backoff-de-lotes.js';

export const INTERVALO_DO_AGENDADOR_MS = 1_000;
/** Candidatos por tick (specs/010 passo 2); o mesmo teto padrão de `candidatosAoEncerramento`. */
export const LIMITE_DE_CANDIDATOS_POR_TICK = 20;
const NOME_DO_INTERVALO = 'encerramento-de-lotes';
const NOME_SEGURO = /^[A-Za-z0-9_]{1,64}$/;
const CODIGO_SEGURO = /^[A-Z0-9_]{1,64}$/;

export interface OpcoesDeInicio {
  /** Registro idempotente da chave de assinatura (specs/008); falha → o agendador não inicia. */
  readonly registrarChave: () => Promise<void>;
}

/** Descreve o erro sem vazar nada: nome e código só se tiverem formato de identificador. */
export function descreverErro(erro: unknown): string {
  const nome = erro instanceof Error && NOME_SEGURO.test(erro.name) ? erro.name : 'Error';
  const bruto = (erro as { codigo?: unknown } | null)?.codigo;
  const codigo = typeof bruto === 'string' && CODIGO_SEGURO.test(bruto) ? bruto : undefined;
  return codigo === undefined ? `erro=${nome}` : `erro=${nome} codigo=${codigo}`;
}

@Injectable()
export class AgendadorDoEncerramento {
  readonly #logger = new Logger('Agendador');
  readonly #backoff = new BackoffDeLotes();
  #tickEmAndamento: Promise<void> | null = null;
  #ativo = false;

  constructor(
    @Inject(BANCO) private readonly banco: Banco,
    @Inject(PublicadorDeEventos) private readonly publicador: PublicadorDeEventos,
    @Inject(ServicoDeEncerramento) private readonly encerramento: ServicoDeEncerramento,
    @Inject(SchedulerRegistry) private readonly registro: SchedulerRegistry,
  ) {}

  /** Liga o job. Devolve false (sem ligar) se a chave não pôde ser registrada: falha fechada. */
  async iniciar(opcoes: OpcoesDeInicio): Promise<boolean> {
    if (this.#ativo) return true;
    try {
      await opcoes.registrarChave();
    } catch (erro: unknown) {
      this.#logger.error(
        `agendador não iniciado: chave de assinatura não registrada; ${descreverErro(erro)}`,
      );
      return false;
    }
    this.#ativo = true;
    const intervalo = setInterval(() => {
      void this.executarTick();
    }, INTERVALO_DO_AGENDADOR_MS);
    this.registro.addInterval(NOME_DO_INTERVALO, intervalo);
    return true;
  }

  /** Desliga o job e espera o tick em andamento terminar. */
  async parar(): Promise<void> {
    if (this.#ativo) {
      this.#ativo = false;
      if (this.registro.doesExist('interval', NOME_DO_INTERVALO)) {
        this.registro.deleteInterval(NOME_DO_INTERVALO);
      }
    }
    await this.#tickEmAndamento;
  }

  /** Um tick; ignorado se o anterior ainda roda (sem sobreposição). Nunca rejeita. */
  executarTick(): Promise<void> {
    if (this.#tickEmAndamento !== null) return this.#tickEmAndamento;
    const execucao = this.#tick().finally(() => {
      this.#tickEmAndamento = null;
    });
    this.#tickEmAndamento = execucao;
    return execucao;
  }

  async #tick(): Promise<void> {
    await this.#iniciarLotes();
    await this.#encerrarVencidos();
  }

  async #iniciarLotes(): Promise<void> {
    try {
      const ids = await aposCommit(this.publicador, (coletor) =>
        this.banco.transaction(async (tx) => {
          await tx.execute(sql`set transaction isolation level read committed`);
          const iniciados = await iniciarLotesPendentes(tx);
          for (const loteId of iniciados) {
            coletor.agendar({ tipo: 'lote_iniciado', payload: { loteId } });
          }
          return iniciados;
        }),
      );
      if (ids.length > 0) this.#logger.log(`lotes iniciados: ${String(ids.length)}`);
    } catch (erro: unknown) {
      this.#logger.error(`falha ao iniciar lotes; ${descreverErro(erro)}`);
    }
  }

  async #encerrarVencidos(): Promise<void> {
    let candidatos: string[];
    try {
      const excluidos = this.#backoff.excluidos(performance.now());
      candidatos = await this.banco.consultar((db) =>
        candidatosAoEncerramento(db, LIMITE_DE_CANDIDATOS_POR_TICK, excluidos),
      );
    } catch (erro: unknown) {
      this.#logger.error(`falha na varredura de candidatos; ${descreverErro(erro)}`);
      return;
    }
    if (candidatos.length < LIMITE_DE_CANDIDATOS_POR_TICK) {
      this.#backoff.zerarOsQueSairamDaSelecao(performance.now(), candidatos);
    }
    for (const loteId of candidatos) {
      await this.#encerrarUm(loteId);
    }
  }

  async #encerrarUm(loteId: string): Promise<void> {
    try {
      const concluido = await this.encerramento.encerrar(loteId);
      this.#backoff.zerar(loteId);
      if (concluido !== null) this.#logger.log(`lote encerrado: ${loteId}`);
    } catch (erro: unknown) {
      const { primeira, esperaMs } = this.#backoff.falhar(loteId, performance.now());
      const detalhe = `${descreverErro(erro)} loteId=${loteId} backoffMs=${String(esperaMs)}`;
      if (primeira) {
        this.#logger.error(`LOTE_COM_FALHA_DE_ENCERRAMENTO ${detalhe}`);
      } else {
        this.#logger.error(`falha no encerramento; ${detalhe}`);
      }
    }
  }
}
