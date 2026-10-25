import type { SchemasApi } from '@leilao/contracts';

import { requisitar } from './cliente';

export type Saldo = SchemasApi['Saldo'];
export type Lancamento = SchemasApi['Lancamento'];
export type RespostaDeposito = SchemasApi['RespostaDeposito'];
export type MetaPaginacao = SchemasApi['MetaPaginacao'];

export interface PaginaDoExtrato {
  lancamentos: Lancamento[];
  meta: MetaPaginacao;
}

export async function obterSaldo(): Promise<Saldo> {
  const resposta = await requisitar<{ dados: Saldo }>('GET', '/api/carteira');
  return resposta.dados;
}

export async function obterExtrato(pagina: number): Promise<PaginaDoExtrato> {
  const resposta = await requisitar<{ dados: Lancamento[]; meta: MetaPaginacao }>(
    'GET',
    '/api/carteira/extrato',
    { consulta: { pagina } },
  );
  return { lancamentos: resposta.dados, meta: resposta.meta };
}

/** A mesma `chaveDeIdempotencia` com o mesmo valor é segura de repetir (specs/004). */
export async function depositar(
  valorCentavos: number,
  chaveDeIdempotencia: string,
): Promise<RespostaDeposito['dados']> {
  const resposta = await requisitar<RespostaDeposito>('POST', '/api/carteira/depositos', {
    corpo: { valorCentavos },
    cabecalhos: { 'Idempotency-Key': chaveDeIdempotencia },
  });
  return resposta.dados;
}
