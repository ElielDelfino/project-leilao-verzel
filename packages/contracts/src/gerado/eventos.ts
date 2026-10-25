// Arquivo gerado por `pnpm contracts:gen` a partir de eventbus/socketio/asyncapi.yaml. Não edite à mão.
export type paths = Record<string, never>;
export type webhooks = Record<string, never>;
export interface components {
  schemas: {
    /** Format: uuid */
    Uuid: string;
    Centavos: number;
    /** Format: date-time */
    Instante: string;
    /** @description Pseudônimo estável por lote (specs/008). */
    Pseudonimo: string;
    LanceAceito: {
      loteId: components['schemas']['Uuid'];
      seq: number;
      pseudonimo: components['schemas']['Pseudonimo'];
      valorCentavos: components['schemas']['Centavos'];
      criadoEm: components['schemas']['Instante'];
      fimEm: components['schemas']['Instante'];
      totalLances: number;
    };
    FimEstendido: {
      loteId: components['schemas']['Uuid'];
      fimEm: components['schemas']['Instante'];
    };
    LoteIniciado: {
      loteId: components['schemas']['Uuid'];
    };
    LoteEncerrado: {
      loteId: components['schemas']['Uuid'];
      vencedorPseudonimo?: components['schemas']['Pseudonimo'];
      valorArremateCentavos?: components['schemas']['Centavos'];
    };
    LoteCancelado: {
      loteId: components['schemas']['Uuid'];
    };
    VoceFoiSuperado: {
      loteId: components['schemas']['Uuid'];
      valorCentavos: components['schemas']['Centavos'];
    };
    SaldoAtualizado: {
      totalCentavos: components['schemas']['Centavos'];
      comprometidoCentavos: components['schemas']['Centavos'];
      disponivelCentavos: components['schemas']['Centavos'];
    };
    LoteArrematado: {
      loteId: components['schemas']['Uuid'];
      codigoComprovante: string;
    };
  };
  responses: never;
  parameters: never;
  requestBodies: never;
  headers: never;
  pathItems: never;
}
export type $defs = Record<string, never>;
export type operations = Record<string, never>;

/** Eventos servidor → cliente do namespace /leilao: nome do evento → payload. */
export interface EventosDoServidor {
  lance_aceito: components['schemas']['LanceAceito'];
  fim_estendido: components['schemas']['FimEstendido'];
  lote_iniciado: components['schemas']['LoteIniciado'];
  lote_encerrado: components['schemas']['LoteEncerrado'];
  lote_cancelado: components['schemas']['LoteCancelado'];
  voce_foi_superado: components['schemas']['VoceFoiSuperado'];
  saldo_atualizado: components['schemas']['SaldoAtualizado'];
  lote_arrematado: components['schemas']['LoteArrematado'];
}
