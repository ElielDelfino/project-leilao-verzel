// Esqueleto de `pnpm db:seed` (tarefa 003). As etapas chegam com as tarefas de cada módulo; a
// primeira são as contas demo de specs/003 RF-03, com a senha de SEED_DEMO_PASSWORD (nunca fixa
// no código). Todas as etapas rodam numa única transação: ou o seed inteiro entra, ou nada.
//
// Roda direto no Node >= 24.2 (type stripping e import.meta.main) com o hook resolver-ts.mjs
// (script na raiz).
import { drizzle } from 'drizzle-orm/node-postgres';

import type { Transacao } from './banco.js';
import { causaParaExibir, comClienteAvulso, criarClientePg, SEM_CAUSA } from './cliente-avulso.js';
import { type ConexaoDoBanco, ErroDeConfiguracaoDoBanco, lerConexaoDoBanco } from './conexao.js';
import { converterErroDoBanco, ErroDoBanco } from './erros.js';

export interface EtapaDoSeed {
  readonly nome: string;
  executar(tx: Transacao, env: Readonly<Record<string, string | undefined>>): Promise<void>;
}

/**
 * Falha de uma etapa; a transação inteira é desfeita. A `cause` já vem convertida por
 * converterErroDoBanco: nunca é o DrizzleQueryError cru, com SQL e valores semeados.
 */
export class ErroNaEtapa extends Error {
  override readonly name = 'ErroNaEtapa';
  readonly etapa: string;

  constructor(etapa: string, causa: unknown) {
    super(`etapa "${etapa}" falhou`, { cause: converterErroDoBanco(causa) });
    this.etapa = etapa;
  }
}

/** Etapas na ordem de execução. Vazia até a F1. */
export const ETAPAS: readonly EtapaDoSeed[] = [];

/** Executa as etapas numa transação e devolve os nomes das que rodaram. */
export async function semear(
  conexao: ConexaoDoBanco,
  etapas: readonly EtapaDoSeed[],
  env: Readonly<Record<string, string | undefined>>,
): Promise<string[]> {
  return comClienteAvulso(
    conexao,
    (cliente) =>
      drizzle({ client: cliente }).transaction(async (tx) => {
        const executadas: string[] = [];
        for (const etapa of etapas) {
          try {
            await etapa.executar(tx, env);
          } catch (erro: unknown) {
            throw new ErroNaEtapa(etapa.nome, erro);
          }
          executadas.push(etapa.nome);
        }
        return executadas;
      }),
    criarClientePg,
  );
}

/**
 * Nome da etapa e SQLSTATE; nunca a mensagem do driver nem a do Drizzle, que podem repetir
 * valores semeados. A de ErroDeConfiguracaoDoBanco é mostrada: ela só cita nomes de variáveis.
 */
export function descreverFalha(erro: unknown): string {
  if (erro instanceof ErroDeConfiguracaoDoBanco) {
    return erro.message;
  }
  const prefixo = erro instanceof ErroNaEtapa ? `${erro.message}: ` : '';
  const causa = causaParaExibir(erro instanceof ErroNaEtapa ? erro.cause : erro);
  const convertida = converterErroDoBanco(causa);
  if (convertida instanceof ErroDoBanco) {
    return `${prefixo}SQLSTATE ${convertida.codigo ?? '?'}`;
  }
  if (causa === SEM_CAUSA) {
    return `${prefixo}consulta do Drizzle falhou sem causa do driver`;
  }
  return `${prefixo}${causa instanceof Error ? causa.name : 'falha desconhecida'}`;
}

async function principal(): Promise<void> {
  const executadas = await semear(lerConexaoDoBanco(process.env), ETAPAS, process.env);
  const resumo = executadas.length === 0 ? 'nenhuma etapa registrada' : executadas.join(', ');
  process.stdout.write(`db:seed: ${resumo}.\n`);
}

if (import.meta.main) {
  principal().catch((erro: unknown) => {
    process.stderr.write(`db:seed falhou: ${descreverFalha(erro)}\n`);
    process.exitCode = 1;
  });
}
