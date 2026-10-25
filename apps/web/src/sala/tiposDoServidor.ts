// Espelho dos schemas `Estado` e `AckEntrarLote` de eventbus/socketio/asyncapi.yaml: o pacote
// @leilao/contracts só exporta o mapa de eventos (`EventosDoServidor`), não esses schemas.
// Quando ele os exportar, troque este arquivo pelos tipos gerados.
export type StatusDoLote = 'agendado' | 'ao_vivo' | 'encerrado' | 'cancelado';
export type PosicaoNoLote = 'ganhando' | 'superado' | 'venceu' | 'perdeu' | 'sem_lance';

export interface LanceDoHistorico {
  seq: number;
  pseudonimo: string;
  valorCentavos: number;
  criadoEm: string;
}

export interface LoteDoEstado {
  id: string;
  status: StatusDoLote;
  inicioEm: string;
  fimEm: string;
  fimOriginalEm: string;
  lanceInicialCentavos: number;
  incrementoMinimoCentavos: number;
  lanceAtualCentavos: number | null;
  totalLances: number;
  valorArremateCentavos: number | null;
}

export interface EstadoDoServidor {
  lote: LoteDoEstado;
  /** Até 50 lances, por `seq` decrescente. */
  ultimosLances: LanceDoHistorico[];
  agoraServidor: string;
  seuPseudonimo?: string;
  suaPosicao?: PosicaoNoLote;
}

export type CodigoDeErroDaSala =
  'DADOS_INVALIDOS' | 'NAO_ENCONTRADO' | 'SALA_CHEIA' | 'INDISPONIVEL';

export type AckEntrarLote =
  | { sucesso: true; estado: EstadoDoServidor }
  | { sucesso: false; erro: { codigo: CodigoDeErroDaSala; mensagem: string } };
