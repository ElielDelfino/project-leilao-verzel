// Interface pública do módulo lances (specs/001 §Módulos da API). Outros módulos só importam daqui.
// `CadeiaDeLances` expõe só `anexar` e `selar` (injetável, pois assina com a chave do módulo).
export {
  CadeiaDeLances,
  type LanceAnexado,
  type NovoLance,
  type NovoSelo,
  type SeloGravado,
} from './cadeia.js';
export type { StatusDoSelo } from './integridade/hash.js';
export { LancesModule, registrarChaveDeAssinatura } from './lances.module.js';
