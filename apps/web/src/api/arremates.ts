import type { SchemasApi } from '@leilao/contracts';

import { requisitar } from './cliente';

export type LanceDoUsuario = SchemasApi['LanceDoUsuario'];
export type PosicaoDoLicitante = SchemasApi['PosicaoDoLicitante'];
export type Arremate = SchemasApi['Arremate'];
export type MetaPaginacao = SchemasApi['MetaPaginacao'];

export interface PaginaDe<T> {
  itens: T[];
  meta: MetaPaginacao;
}

async function listar<T>(caminho: string, pagina: number): Promise<PaginaDe<T>> {
  const resposta = await requisitar<{ dados: T[]; meta: MetaPaginacao }>('GET', caminho, {
    consulta: { pagina },
  });
  return { itens: resposta.dados, meta: resposta.meta };
}

/** `GET /api/me/lances`: um item por lote em que o licitante deu lance (24 por página). */
export function listarMeusLances(pagina: number): Promise<PaginaDe<LanceDoUsuario>> {
  return listar<LanceDoUsuario>('/api/me/lances', pagina);
}

/** `GET /api/me/arremates`: os lotes arrematados, com o código do comprovante (24 por página). */
export function listarMeusArremates(pagina: number): Promise<PaginaDe<Arremate>> {
  return listar<Arremate>('/api/me/arremates', pagina);
}
