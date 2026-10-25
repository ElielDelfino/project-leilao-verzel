import type { SchemasApi } from '@leilao/contracts';

import { requisitar } from './cliente';

export type Auditoria = SchemasApi['Auditoria'];
export type ChavePublica = SchemasApi['ChavePublica'];

/** `GET /api/auditoria/lotes/{id}` (público, sem cache: specs/011). */
export async function obterAuditoria(loteId: string): Promise<Auditoria> {
  const resposta = await requisitar<{ dados: Auditoria }>(
    'GET',
    `/api/auditoria/lotes/${encodeURIComponent(loteId)}`,
  );
  return resposta.dados;
}

/** `GET /api/auditoria/chaves`: as chaves públicas que o servidor publica. */
export async function obterChaves(): Promise<ChavePublica[]> {
  const resposta = await requisitar<{ dados: ChavePublica[] }>('GET', '/api/auditoria/chaves');
  return resposta.dados;
}
