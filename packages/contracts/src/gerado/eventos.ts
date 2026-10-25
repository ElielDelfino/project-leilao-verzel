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
    /** @description Payload de `entrar_lote` e `sair_lote`; campo desconhecido é recusado. */
    LoteRef: {
      loteId: components['schemas']['Uuid'];
    };
    /**
     * @description Status derivado dos horários (specs/006 §Estados e status derivado).
     * @enum {string}
     */
    StatusLote: 'agendado' | 'ao_vivo' | 'encerrado' | 'cancelado';
    /**
     * @description Posição do usuário autenticado no lote (specs/007 §Posição do usuário no lote).
     * @enum {string}
     */
    PosicaoNoLote: 'ganhando' | 'superado' | 'venceu' | 'perdeu' | 'sem_lance';
    /** @description Lance pseudonimizado, igual ao de `GET /api/lotes/{id}/lances`. */
    LanceDoHistorico: {
      seq: number;
      pseudonimo: components['schemas']['Pseudonimo'];
      valorCentavos: components['schemas']['Centavos'];
      criadoEm: components['schemas']['Instante'];
    };
    /** @description Campos vivos do lote no estado da sala (specs/009 §Ack de `entrar_lote`). */
    LoteDoEstado: {
      id: components['schemas']['Uuid'];
      status: components['schemas']['StatusLote'];
      inicioEm: components['schemas']['Instante'];
      fimEm: components['schemas']['Instante'];
      fimOriginalEm: components['schemas']['Instante'];
      lanceInicialCentavos: components['schemas']['Centavos'];
      incrementoMinimoCentavos: components['schemas']['Centavos'];
      /** @description Null enquanto não há lance. */
      lanceAtualCentavos: components['schemas']['Centavos'] | null;
      totalLances: number;
      /** @description Null enquanto o lote não foi encerrado com vencedor. */
      valorArremateCentavos: components['schemas']['Centavos'] | null;
    };
    /**
     * @description Estado do lote devolvido no ack de `entrar_lote` (specs/009). `seuPseudonimo` e `suaPosicao`
     *     só vêm para usuário autenticado. Nunca leva nome, e-mail nem id de usuário.
     */
    Estado: {
      lote: components['schemas']['LoteDoEstado'];
      /** @description Até 50 lances, por `seq` decrescente. */
      ultimosLances: components['schemas']['LanceDoHistorico'][];
      agoraServidor: components['schemas']['Instante'];
      seuPseudonimo?: components['schemas']['Pseudonimo'];
      suaPosicao?: components['schemas']['PosicaoNoLote'];
    };
    /** @description Ack de `entrar_lote`, sucesso ou erro tipado. */
    AckEntrarLote:
      | {
          /** @constant */
          sucesso: true;
          estado: components['schemas']['Estado'];
        }
      | {
          /** @constant */
          sucesso: false;
          erro: {
            /** @enum {string} */
            codigo: 'DADOS_INVALIDOS' | 'NAO_ENCONTRADO' | 'SALA_CHEIA' | 'INDISPONIVEL';
            mensagem: string;
          };
        };
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
      /** @description Valor do novo lance atual, que superou o do destinatário. */
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
