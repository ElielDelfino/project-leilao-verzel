import type { SchemasApi } from '@leilao/contracts';

import { requisitar } from './cliente';

export type RespostaLance = SchemasApi['RespostaLance']['dados'];

/** A mesma `chaveDeIdempotencia` com o mesmo valor é segura de repetir (specs/007). */
export async function darLance(
  loteId: string,
  valorCentavos: number,
  chaveDeIdempotencia: string,
): Promise<RespostaLance> {
  const resposta = await requisitar<SchemasApi['RespostaLance']>(
    'POST',
    `/api/lotes/${encodeURIComponent(loteId)}/lances`,
    { corpo: { valorCentavos }, cabecalhos: { 'Idempotency-Key': chaveDeIdempotencia } },
  );
  return resposta.dados;
}
