import type { SchemasApi } from '@leilao/contracts';

import type { Lote, MetaPaginacao } from './lotes';
import { requisitar } from './cliente';

export type CartaDaBusca = SchemasApi['CartaDaBusca'];
export type LoteEntrada = SchemasApi['LoteEntrada'];

export interface PaginaDeCartas {
  cartas: CartaDaBusca[];
  meta: MetaPaginacao;
}

export async function buscarCartas(q: string, pagina: number): Promise<PaginaDeCartas> {
  const resposta = await requisitar<{ dados: CartaDaBusca[]; meta: MetaPaginacao }>(
    'GET',
    '/api/catalogo/cartas',
    { consulta: { q, pagina } },
  );
  return { cartas: resposta.dados, meta: resposta.meta };
}

export async function criarLote(entrada: LoteEntrada): Promise<Lote> {
  const resposta = await requisitar<{ dados: Lote }>('POST', '/api/painel/lotes', {
    corpo: entrada,
  });
  return resposta.dados;
}
