// Interface pública do módulo carteira (specs/001 §Módulos da API). Outros módulos só importam daqui.
export { CarteiraModule } from './carteira.module.js';
export type { SaldoComDisponivel, SaldoEmCentavos } from './efeito.js';
export {
  type CodigoDoErroDeCarteira,
  comprometer,
  type DetalhesDoErroDeCarteira,
  ErroDeCarteira,
  liberar,
  ordemDeTrava,
  type ReferenciaDoLance,
  travarCarteiras,
} from './interface-do-lance.js';
