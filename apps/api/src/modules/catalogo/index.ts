// Interface pública do módulo catalogo (specs/001 §Módulos da API). Outros módulos só importam daqui:
// `prepararSnapshot(scryfallId)` (rede, sem tx), `gravarSnapshot(tx, preparado)` → snapshotId e
// `obterSnapshot(snapshotId)` sem a imagem (specs/005 §Interfaces e contratos; ADR 0025).
export { CatalogoModule } from './catalogo.module.js';
export {
  type CartaDoSnapshot,
  ServicoDeCatalogo,
  type SnapshotPreparado,
} from './servico-de-catalogo.js';
