import type { SchemasApi } from '@leilao/contracts';

import { requisitar } from './cliente';

export type Lote = SchemasApi['Lote'];
export type LoteDetalhe = SchemasApi['LoteDetalhe'];
export type StatusLote = SchemasApi['StatusLote'];
export type Raridade = SchemasApi['Raridade'];
export type MetaPaginacao = SchemasApi['MetaPaginacao'];

export type StatusDaVitrine = Exclude<StatusLote, 'cancelado'>;
export type OrdemDaVitrine = 'termina_antes' | 'mais_recente' | 'maior_lance';

/** Parâmetros de `GET /api/lotes` (valores padrão já aplicados pela vitrine). */
export interface FiltrosDaVitrine {
  status: StatusDaVitrine;
  q?: string | undefined;
  raridade?: Raridade | undefined;
  precoMin?: number | undefined;
  precoMax?: number | undefined;
  ordem: OrdemDaVitrine;
  pagina: number;
}

export interface PaginaDeLotes {
  lotes: Lote[];
  meta: MetaPaginacao;
}

export async function listarLotes(filtros: FiltrosDaVitrine): Promise<PaginaDeLotes> {
  const consulta: Record<string, string | number> = {
    status: filtros.status,
    ordem: filtros.ordem,
    pagina: filtros.pagina,
  };
  if (filtros.q !== undefined) consulta['q'] = filtros.q;
  if (filtros.raridade !== undefined) consulta['raridade'] = filtros.raridade;
  if (filtros.precoMin !== undefined) consulta['precoMin'] = filtros.precoMin;
  if (filtros.precoMax !== undefined) consulta['precoMax'] = filtros.precoMax;

  const resposta = await requisitar<{ dados: Lote[]; meta: MetaPaginacao }>('GET', '/api/lotes', {
    consulta,
  });
  return { lotes: resposta.dados, meta: resposta.meta };
}

export async function obterLote(id: string): Promise<LoteDetalhe> {
  const resposta = await requisitar<{ dados: LoteDetalhe }>(
    'GET',
    `/api/lotes/${encodeURIComponent(id)}`,
  );
  return resposta.dados;
}
