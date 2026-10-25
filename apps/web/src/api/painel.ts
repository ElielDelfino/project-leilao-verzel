import type { SchemasApi } from '@leilao/contracts';

import type { Lote, MetaPaginacao } from './lotes';
import { requisitar } from './cliente';

export type ResumoDoPainel = SchemasApi['ResumoDoPainel'];

export interface PaginaDeLotesDoPainel {
  lotes: Lote[];
  meta: MetaPaginacao;
}

export async function obterResumo(): Promise<ResumoDoPainel> {
  const resposta = await requisitar<{ dados: ResumoDoPainel }>('GET', '/api/painel/resumo');
  return resposta.dados;
}

export async function listarMeusLotes(pagina: number): Promise<PaginaDeLotesDoPainel> {
  const resposta = await requisitar<{ dados: Lote[]; meta: MetaPaginacao }>(
    'GET',
    '/api/painel/lotes',
    { consulta: { pagina } },
  );
  return { lotes: resposta.dados, meta: resposta.meta };
}
