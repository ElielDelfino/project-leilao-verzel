import type { SchemasApi } from '@leilao/contracts';

import { requisitar } from './cliente';

export type Comprovante = SchemasApi['Comprovante'];

/** `GET /api/comprovantes/{codigo}` (público; o código entra na URL com `encodeURIComponent`). */
export async function obterComprovante(codigo: string): Promise<Comprovante> {
  const resposta = await requisitar<{ dados: Comprovante }>(
    'GET',
    `/api/comprovantes/${encodeURIComponent(codigo)}`,
  );
  return resposta.dados;
}
