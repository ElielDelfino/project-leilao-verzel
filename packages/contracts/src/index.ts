// Arquivo gerado por `pnpm contracts:gen`. Não edite à mão.
// Interface pública de @leilao/contracts: só tipos, gerados dos contratos (specs/001 §Contratos).
import type { EventosDoServidor } from './gerado/eventos.js';
import type { components, operations, paths } from './gerado/openapi.js';

export type { EventosDoServidor };
export type RotasApi = paths;
export type OperacoesApi = operations;
export type SchemasApi = components['schemas'];

/** Mapa de eventos servidor → cliente no formato do Socket.IO (`Server<_, ServidorParaCliente>`). */
export type ServidorParaCliente = {
  [Evento in keyof EventosDoServidor]: (payload: EventosDoServidor[Evento]) => void;
};
