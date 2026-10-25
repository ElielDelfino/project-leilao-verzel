// Interface pública do módulo lotes (specs/001 §Módulos da API). Outros módulos só importam daqui.
export {
  agora,
  type LanceNoLote,
  type LoteDepoisDoLance,
  type LoteTravado,
  obterResumos,
  registrarLance,
  type ResumoDoLote,
  type StatusGravadoDoLote,
  travarLote,
} from './interface-para-lances.js';
export {
  cancelarLote,
  candidatosAoEncerramento,
  type CodigoDoErroDeLote,
  encerrarLote,
  ErroDeLote,
  iniciarLotesPendentes,
  type ResultadoDoEncerramento,
  travarLoteVencido,
} from './interface-para-liquidacao.js';
export { LotesModule } from './lotes.module.js';
export type { StatusDoLote } from './repositorio.js';
