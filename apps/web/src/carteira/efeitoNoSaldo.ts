import { formatarCentavos } from '../formatacao/dinheiro';
import type { TipoDeLancamento } from '../mensagens/erros';

export type Efeito = 'entrada' | 'saida' | 'reserva' | 'devolucao';

export interface EfeitoNoSaldo {
  efeito: Efeito;
  sinal: '+' | '−';
}

const POR_EFEITO: Record<Efeito, EfeitoNoSaldo> = {
  entrada: { efeito: 'entrada', sinal: '+' },
  saida: { efeito: 'saida', sinal: '−' },
  reserva: { efeito: 'reserva', sinal: '−' },
  devolucao: { efeito: 'devolucao', sinal: '+' },
};

/**
 * A API manda `valorCentavos` sempre positivo; o efeito vem do tipo (specs/004 §Comportamento),
 * visto pelo disponível: o compromisso tira do disponível sem tirar do total, e o débito do
 * arremate consome o que já estava reservado.
 */
const EFEITO_DO_TIPO: Record<TipoDeLancamento, Efeito> = {
  deposito: 'entrada',
  credito_arremate: 'entrada',
  debito_arremate: 'saida',
  compromisso: 'reserva',
  liberacao: 'devolucao',
  estorno: 'devolucao',
};

export function efeitoNoSaldo(tipo: TipoDeLancamento): EfeitoNoSaldo {
  return POR_EFEITO[EFEITO_DO_TIPO[tipo]];
}

export function valorComSinal(tipo: TipoDeLancamento, valorCentavos: number): string {
  return `${efeitoNoSaldo(tipo).sinal}\u00a0${formatarCentavos(valorCentavos)}`;
}
