import type { Lote, Raridade, StatusLote } from '../api/lotes';
import { formatarDataHora } from '../formatacao/data';
import { formatarCentavos } from '../formatacao/dinheiro';

// Rótulos de specs/012 §Vitrine, usados também no detalhe, no painel e no novo lote.
export const ROTULOS_DE_STATUS: Record<StatusLote, string> = {
  ao_vivo: 'Ao vivo',
  agendado: 'Agendado',
  encerrado: 'Encerrado',
  cancelado: 'Cancelado',
};

export const ICONES_DE_STATUS: Record<StatusLote, string> = {
  ao_vivo: '●',
  agendado: '◷',
  encerrado: '■',
  cancelado: '✕',
};

export const ROTULOS_DE_RARIDADE: Record<Raridade, string> = {
  common: 'Comum',
  uncommon: 'Incomum',
  rare: 'Rara',
  mythic: 'Mítica',
  special: 'Especial',
  bonus: 'Bônus',
};

export const RARIDADES: readonly Raridade[] = [
  'common',
  'uncommon',
  'rare',
  'mythic',
  'special',
  'bonus',
];

export function textoDeLances(total: number): string {
  if (total === 0) return 'Nenhum lance';
  return total === 1 ? '1 lance' : `${total} lances`;
}

type DadosDePreco = Pick<
  Lote,
  'status' | 'valorArremateCentavos' | 'lanceAtualCentavos' | 'lanceInicialCentavos'
>;

/** Linha de preço do cartão da vitrine (specs/012 §Vitrine). */
export function textoDePreco(lote: DadosDePreco): string {
  if (lote.status === 'encerrado' && lote.valorArremateCentavos !== null) {
    return `Arrematado por ${formatarCentavos(lote.valorArremateCentavos)}`;
  }
  if (lote.status === 'encerrado' && lote.lanceAtualCentavos === null) {
    return 'Encerrado sem lances';
  }
  if (lote.lanceAtualCentavos !== null) {
    return `Lance atual: ${formatarCentavos(lote.lanceAtualCentavos)}`;
  }
  return `Lance inicial: ${formatarCentavos(lote.lanceInicialCentavos)}`;
}

/** Linha de horário do cartão da vitrine. */
export function textoDeHorario(lote: Pick<Lote, 'status' | 'inicioEm' | 'fimEm'>): string {
  if (lote.status === 'agendado') return `Começa em ${formatarDataHora(lote.inicioEm)}`;
  if (lote.status === 'encerrado') return `Encerrado em ${formatarDataHora(lote.fimEm)}`;
  return `Termina em ${formatarDataHora(lote.fimEm)}`;
}
