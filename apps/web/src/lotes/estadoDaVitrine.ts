import type { FiltrosDaVitrine, OrdemDaVitrine, Raridade, StatusDaVitrine } from '../api/lotes';
import { PRECO_MAXIMO_CENTAVOS } from './precoEmReais';
import { RARIDADES } from './rotulos';

// Estado da vitrine na URL (specs/012 §Vitrine): valores padrão não aparecem.
export const STATUS_PADRAO: StatusDaVitrine = 'ao_vivo';
export const ORDEM_PADRAO: OrdemDaVitrine = 'termina_antes';
export const STATUS_DA_VITRINE: readonly StatusDaVitrine[] = ['ao_vivo', 'agendado', 'encerrado'];
export const ORDENS: readonly OrdemDaVitrine[] = ['termina_antes', 'mais_recente', 'maior_lance'];
export const TAMANHO_DA_PAGINA = 24;
const MAXIMO_DA_BUSCA = 100;

function inteiro(valor: string | null, minimo: number, maximo: number): number | undefined {
  if (valor === null || !/^\d+$/.test(valor)) return undefined;
  const numero = Number(valor);
  return Number.isSafeInteger(numero) && numero >= minimo && numero <= maximo ? numero : undefined;
}

function opcao<T extends string>(valor: string | null, validas: readonly T[]): T | undefined {
  return validas.find((v) => v === valor);
}

export function lerFiltros(params: URLSearchParams): FiltrosDaVitrine {
  const q = params.get('q')?.trim();
  const precoMin = inteiro(params.get('precoMin'), 0, PRECO_MAXIMO_CENTAVOS);
  let precoMax = inteiro(params.get('precoMax'), 0, PRECO_MAXIMO_CENTAVOS);
  if (precoMax !== undefined && precoMin !== undefined && precoMax < precoMin) precoMax = undefined;
  return {
    status: opcao(params.get('status'), STATUS_DA_VITRINE) ?? STATUS_PADRAO,
    q: q && q.length <= MAXIMO_DA_BUSCA ? q : undefined,
    raridade: opcao<Raridade>(params.get('raridade'), RARIDADES),
    precoMin,
    precoMax,
    ordem: opcao(params.get('ordem'), ORDENS) ?? ORDEM_PADRAO,
    pagina: inteiro(params.get('pagina'), 1, Number.MAX_SAFE_INTEGER) ?? 1,
  };
}

/** Serializa só o que difere do padrão, numa ordem estável. */
export function escreverFiltros(filtros: FiltrosDaVitrine): URLSearchParams {
  const params = new URLSearchParams();
  if (filtros.status !== STATUS_PADRAO) params.set('status', filtros.status);
  if (filtros.q) params.set('q', filtros.q);
  if (filtros.raridade) params.set('raridade', filtros.raridade);
  if (filtros.precoMin !== undefined) params.set('precoMin', String(filtros.precoMin));
  if (filtros.precoMax !== undefined) params.set('precoMax', String(filtros.precoMax));
  if (filtros.ordem !== ORDEM_PADRAO) params.set('ordem', filtros.ordem);
  if (filtros.pagina > 1) params.set('pagina', String(filtros.pagina));
  return params;
}

export function temFiltroDeBusca(filtros: FiltrosDaVitrine): boolean {
  return (
    filtros.q !== undefined ||
    filtros.raridade !== undefined ||
    filtros.precoMin !== undefined ||
    filtros.precoMax !== undefined
  );
}
