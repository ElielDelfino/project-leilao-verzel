// Interface pública do módulo lances (specs/001 §Módulos da API). Outros módulos só importam daqui.
// `CadeiaDeLances` expõe só `anexar` e `selar` (injetável, pois assina com a chave do módulo).
// `selar` recusa com `ErroDeSelo` (LOTE_DIVERGENTE, SELO_JA_GRAVADO) e exige rollback da `tx`.
export {
  CadeiaDeLances,
  type CodigoDoErroDeSelo,
  ErroDeSelo,
  type LanceAnexado,
  type LoteTravado,
  type NovoLance,
  type NovoSelo,
  type SeloGravado,
  type StatusDoLoteTravado,
} from './cadeia.js';
export type { StatusDoSelo } from './integridade/hash.js';
export { LancesModule, registrarChaveDeAssinatura } from './lances.module.js';
// Leituras para o estado da sala (specs/009): `posicaoDoUsuario(loteId, userId)`,
// `ultimosLances(loteId, n)` e `seuPseudonimo(loteId, userId)`, métodos de `LeiturasDeLances`.
export { LeiturasDeLances, type PaginaDeLances } from './leituras-de-lances.js';
export type { LancePublico, PosicaoDoUsuario } from './regras.js';
