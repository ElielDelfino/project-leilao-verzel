// Prontidão (GET /api/health/ready): Postgres e Redis respondendo (specs/014 §Observabilidade).
import { Inject, Injectable, Logger } from '@nestjs/common';

/** Uma dependência que precisa responder para a API estar pronta (ex.: postgres, redis). */
export interface VerificacaoDeProntidao {
  readonly nome: string;
  /** Resolve se a dependência respondeu; rejeita caso contrário. */
  verificar(): Promise<void>;
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

function descreverMotivo(motivo: unknown): string {
  return motivo instanceof Error ? `${motivo.name}: ${motivo.message}` : 'motivo desconhecido';
}

async function comTempoLimite(promessa: Promise<void>, limiteMs: number): Promise<void> {
  let temporizador: NodeJS.Timeout | undefined;
  const limite = new Promise<never>((_, rejeitar) => {
    temporizador = setTimeout(
      () => rejeitar(new TempoEsgotado(`sem resposta em ${limiteMs} ms`)),
      limiteMs,
    );
  });
  try {
    await Promise.race([promessa, limite]);
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

  async verificar(): Promise<ResultadoDaProntidao> {
    // Falha fechada: sem nenhuma verificação registrada, nada foi comprovado.
    if (this.verificacoes.length === 0) {
      this.logger.warn('nenhuma verificação de prontidão registrada');
      return { pronto: false, falhas: [] };
    }

    const resultados = await Promise.allSettled(
      this.verificacoes.map((verificacao) =>
        comTempoLimite(verificacao.verificar(), TEMPO_LIMITE_DA_VERIFICACAO_MS),
      ),
    );

    const falhas = this.verificacoes.flatMap((verificacao, indice) => {
      const resultado = resultados[indice];
      if (resultado?.status !== 'rejected') {
        return [];
      }
      this.logger.warn(
        `verificação de prontidão falhou: ${verificacao.nome} (${descreverMotivo(resultado.reason)})`,
      );
      return [verificacao.nome];
    });

    return { pronto: falhas.length === 0, falhas };
  }
}
