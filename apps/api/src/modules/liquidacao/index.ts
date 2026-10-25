// Interface pública do módulo liquidacao (specs/001 §Módulos da API). Outros módulos só importam daqui.
export { type CodigoDoErroDeLiquidacao, ErroDeLiquidacao } from './encerramento/erros.js';
export {
  type EncerramentoConcluido,
  ServicoDeEncerramento,
  type VencedorDoLote,
} from './encerramento/servico-de-encerramento.js';
export { LiquidacaoModule } from './liquidacao.module.js';
