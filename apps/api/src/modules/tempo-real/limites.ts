// Limites do tempo real (specs/009 RNF-02): 50 conexões por lote e 200 no total numa e2-micro, mais
// dois tetos por socket (rooms de lote e eventos por segundo) contra um cliente que abusa.

/** Quantos rooms de lote um mesmo socket pode ter ao mesmo tempo. */
export const MAXIMO_DE_SALAS_DE_LOTE_POR_SOCKET = 10;
/** Quantos eventos do cliente um socket pode mandar por janela. */
export const MAXIMO_DE_EVENTOS_POR_JANELA = 20;
/** Tamanho da janela do limite de eventos. */
export const JANELA_DE_EVENTOS_MS = 1_000;

export interface LimitesDoTempoReal {
  readonly porLote: number;
  readonly total: number;
  readonly salasDeLotePorSocket: number;
  readonly eventosPorJanela: number;
}

export const LIMITES_PADRAO: LimitesDoTempoReal = Object.freeze({
  porLote: 50,
  total: 200,
  salasDeLotePorSocket: MAXIMO_DE_SALAS_DE_LOTE_POR_SOCKET,
  eventosPorJanela: MAXIMO_DE_EVENTOS_POR_JANELA,
});

/** Token de injeção dos limites (os testes trocam por valores pequenos). */
export const LIMITES_DO_TEMPO_REAL = Symbol('LIMITES_DO_TEMPO_REAL');

/**
 * Contador de conexões do namespace. A vaga é reservada de forma síncrona, antes de qualquer
 * `await` do handshake, para dois handshakes simultâneos não passarem juntos pelo último lugar.
 */
export class ReservaDeConexoes {
  private ocupadas = 0;

  constructor(private readonly limite: number) {}

  /** Reserva uma vaga; devolve a função que a libera (idempotente), ou `undefined` se cheio. */
  reservar(): (() => void) | undefined {
    if (this.ocupadas >= this.limite) {
      return undefined;
    }
    this.ocupadas += 1;
    let liberada = false;
    return () => {
      if (!liberada) {
        liberada = true;
        this.ocupadas -= 1;
      }
    };
  }

  get emUso(): number {
    return this.ocupadas;
  }
}

/**
 * Limite de eventos de um socket numa janela fixa de 1 s. Um objeto por socket; o relógio entra por
 * parâmetro para o teste não depender de espera real.
 */
export class LimiteDeEventos {
  private inicioDaJanela = Number.NEGATIVE_INFINITY;
  private usados = 0;
  private recusados = 0;

  constructor(
    private readonly maximoPorJanela: number,
    private readonly janelaMs: number = JANELA_DE_EVENTOS_MS,
  ) {}

  /** Conta o evento e diz se ele passa. */
  permitir(agoraMs: number): boolean {
    if (agoraMs - this.inicioDaJanela >= this.janelaMs) {
      this.inicioDaJanela = agoraMs;
      this.usados = 0;
    }
    if (this.usados >= this.maximoPorJanela) {
      this.recusados += 1;
      return false;
    }
    this.usados += 1;
    return true;
  }

  /** Total de eventos recusados desde a criação (o gateway avisa só na primeira recusa). */
  get totalRecusado(): number {
    return this.recusados;
  }
}
