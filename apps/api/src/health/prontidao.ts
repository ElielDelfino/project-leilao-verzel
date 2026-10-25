// Prontidão (GET /api/health/ready): Postgres e Redis respondendo (specs/014 §Observabilidade).
import { Inject, Injectable, Logger } from '@nestjs/common';

import { descreverFalhaSemDetalhes } from '../logger/falha-sem-detalhes.js';

/** Uma dependência que precisa responder para a API estar pronta (ex.: postgres, redis). */
export interface VerificacaoDeProntidao {
  readonly nome: string;
  /**
   * Resolve se a dependência respondeu; rejeita caso contrário. O `sinal` é abortado quando o
   * tempo limite estoura: repasse-o ao cliente (ping, query) para cancelar a operação.
   */
  verificar(sinal: AbortSignal): Promise<void>;
}

/** Token das verificações registradas (lista de VerificacaoDeProntidao). */
export const VERIFICACOES_DE_PRONTIDAO = Symbol('VERIFICACOES_DE_PRONTIDAO');

/** Uma verificação que não responde dentro deste tempo conta como falha. */
export const TEMPO_LIMITE_DA_VERIFICACAO_MS = 2_000;

export interface ResultadoDaProntidao {
  readonly pronto: boolean;
  /** Nomes das verificações que falharam (só para log; não vão na resposta pública). */
  readonly falhas: readonly string[];
}

class TempoEsgotado extends Error {
  override readonly name = 'TempoEsgotado';
}

/** Chama a verificação já com o sinal; um `throw` síncrono vira promessa rejeitada. */
function iniciar(verificacao: VerificacaoDeProntidao, sinal: AbortSignal): Promise<void> {
  try {
    return verificacao.verificar(sinal);
  } catch (erro: unknown) {
    return Promise.reject(erro);
  }
}

/**
 * Roda a verificação com tempo limite. Ao estourar, aborta o sinal entregue à verificação e
 * rejeita com TempoEsgotado. Usa setTimeout + AbortController (equivalente a
 * `AbortSignal.timeout`) para limpar o temporizador quando a verificação termina antes.
 * Uma verificação que lança de forma síncrona também vira rejeição.
 */
async function comTempoLimite(
  verificacao: VerificacaoDeProntidao,
  limiteMs: number,
): Promise<void> {
  const controlador = new AbortController();
  let temporizador: NodeJS.Timeout | undefined;
  const limite = new Promise<never>((_, rejeitar) => {
    temporizador = setTimeout(() => {
      const motivo = new TempoEsgotado(`sem resposta em ${limiteMs} ms`);
      controlador.abort(motivo);
      rejeitar(motivo);
    }, limiteMs);
  });
  try {
    await Promise.race([iniciar(verificacao, controlador.signal), limite]);
  } finally {
    clearTimeout(temporizador);
  }
}

@Injectable()
export class ServicoDeProntidao {
  private readonly logger = new Logger(ServicoDeProntidao.name);

  constructor(
    @Inject(VERIFICACOES_DE_PRONTIDAO)
    private readonly verificacoes: readonly VerificacaoDeProntidao[],
  ) {}

  #emAndamento: Promise<ResultadoDaProntidao> | undefined;

  /**
   * Single-flight (revisão da 017): chamadas concorrentes recebem a mesma rodada em andamento,
   * para que várias requisições ao /ready não esgotem o pool do Postgres. Terminada a rodada, a
   * próxima chamada verifica de novo.
   */
  verificar(): Promise<ResultadoDaProntidao> {
    this.#emAndamento ??= this.executar().finally(() => {
      this.#emAndamento = undefined;
    });
    return this.#emAndamento;
  }

  private async executar(): Promise<ResultadoDaProntidao> {
    // Falha fechada: sem nenhuma verificação registrada, nada foi comprovado.
    if (this.verificacoes.length === 0) {
      this.logger.warn('nenhuma verificação de prontidão registrada');
      return { pronto: false, falhas: [] };
    }

    const resultados = await Promise.allSettled(
      this.verificacoes.map((verificacao) =>
        comTempoLimite(verificacao, TEMPO_LIMITE_DA_VERIFICACAO_MS),
      ),
    );

    const falhas = this.verificacoes.flatMap((verificacao, indice) => {
      const resultado = resultados[indice];
      if (resultado?.status !== 'rejected') {
        return [];
      }
      this.logger.warn(
        `verificação de prontidão falhou: ${verificacao.nome} (${descreverFalhaSemDetalhes(resultado.reason)})`,
      );
      return [verificacao.nome];
    });

    return { pronto: falhas.length === 0, falhas };
  }
}
