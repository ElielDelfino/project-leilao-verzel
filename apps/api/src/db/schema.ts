// Tipos compartilhados do banco, criados pela migration 0000 (tarefa 003). Ficam aqui, e não no
// schema.ts de cada módulo, porque a migration base os cria antes das tabelas; os módulos donos
// (specs/001 §Módulos) importam daqui ao declarar as suas colunas. O drizzle-kit lê este arquivo
// (apps/api/drizzle.config.ts), então o snapshot dele já conhece os enums e não os recria.
import { pgEnum } from 'drizzle-orm/pg-core';

/** specs/003 RF-01: o papel é imutável. Tabela dona: users (identidade). */
export const papelUsuario = pgEnum('papel_usuario', ['leiloeiro', 'licitante']);

/** specs/006 §Comportamento: agendado → ao_vivo → encerrado; agendado|ao_vivo → cancelado. */
export const statusLote = pgEnum('status_lote', ['agendado', 'ao_vivo', 'encerrado', 'cancelado']);

/** specs/004 §Comportamento: tipos de lançamento do ledger (carteira). */
export const tipoLancamento = pgEnum('tipo_lancamento', [
  'deposito',
  'compromisso',
  'liberacao',
  'estorno',
  'debito_arremate',
  'credito_arremate',
]);
