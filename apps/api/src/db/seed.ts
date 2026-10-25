// `pnpm db:seed` (tarefas 003 e 037). Todas as etapas rodam numa única transação: ou o seed
// inteiro entra, ou nada. Conecta como o dono (POSTGRES_USER e DB_PASSWORD ou DB_PASSWORD_FILE).
//
// Etapas por módulo (D14 da tarefa 036): cada módulo que semeia tem `src/modules/<m>/seed.ts`
// exportando `etapasDoSeed: readonly EtapaDoSeed[]`. O db:seed carrega esses arquivos na ordem de
// specs/001 §Módulos (ORDEM_DOS_MODULOS); módulo sem seed.ts não entra. Regras desses arquivos:
// - as etapas são idempotentes (rodar o seed de novo não duplica nem falha);
// - senha só de SEED_DEMO_PASSWORD, recebida no `env` da etapa, nunca fixa no código;
// - o db:seed roda com type stripping do Node, sem build: nem o seed.ts nem o que ele importa
//   podem usar decorators, `enum`, `namespace`, parameter properties nem outra sintaxe do
//   TypeScript que não seja apagável; imports relativos com `.js` (o resolver-ts.mjs troca por
//   `.ts`). Importe tabelas do schema.ts do próprio módulo, não o módulo Nest.
//
// Roda direto no Node >= 24.2 (type stripping e import.meta.main) com o hook resolver-ts.mjs
// (script na raiz).
import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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

/** Módulos na ordem de specs/001 §Módulos: a ordem em que as etapas de cada um rodam. */
export const ORDEM_DOS_MODULOS = Object.freeze([
  'identidade',
  'carteira',
  'catalogo',
  'lotes',
  'lances',
  'tempo-real',
  'liquidacao',
] as const);

/** Pasta dos módulos (src/modules ou dist/modules, conforme de onde este arquivo roda). */
export const PASTA_DOS_MODULOS = fileURLToPath(new URL('../modules', import.meta.url));

/** `.ts` quando roda do fonte (type stripping), `.js` quando roda do build. */
const EXTENSAO = extname(fileURLToPath(import.meta.url));

/** seed.ts de módulo com export ausente ou malformado. Cita só o módulo. */
export class ErroDoSeedDoModulo extends Error {
  override readonly name = 'ErroDoSeedDoModulo';
}

function ehEtapa(valor: unknown): valor is EtapaDoSeed {
  return (
    typeof valor === 'object' &&
    valor !== null &&
    'nome' in valor &&
    typeof valor.nome === 'string' &&
    valor.nome !== '' &&
    'executar' in valor &&
    typeof valor.executar === 'function'
  );
}

/** Código do erro de import (ERR_MODULE_NOT_FOUND etc.); a mensagem pode citar caminhos e código. */
function codigoDoErro(erro: unknown): string {
  return typeof erro === 'object' &&
    erro !== null &&
    'code' in erro &&
    typeof erro.code === 'string'
    ? erro.code
    : 'sem código';
}

/**
 * Importa o seed de um módulo. Falha no import vira ErroDoSeedDoModulo só com o módulo e o
 * código do erro: a mensagem original (e a `cause`) fica de fora, porque pode trazer trechos
 * do arquivo ou caminhos absolutos.
 */
async function importarEtapas(arquivo: string, rotulo: string): Promise<unknown> {
  let modulo: { etapasDoSeed?: unknown };
  try {
    modulo = (await import(pathToFileURL(arquivo).href)) as { etapasDoSeed?: unknown };
  } catch (erro: unknown) {
    throw new ErroDoSeedDoModulo(`${rotulo}: falha ao importar (${codigoDoErro(erro)})`);
  }
  return modulo.etapasDoSeed;
}

/**
 * Carrega `etapasDoSeed` de `<pasta>/<m>/seed.ts` (ou `.js`) para cada módulo de
 * ORDEM_DOS_MODULOS que tiver o arquivo, nesta ordem. Sem nenhum arquivo, devolve [].
 */
export async function carregarEtapas(
  pasta: string = PASTA_DOS_MODULOS,
  extensao: string = EXTENSAO,
): Promise<EtapaDoSeed[]> {
  const etapas: EtapaDoSeed[] = [];
  for (const modulo of ORDEM_DOS_MODULOS) {
    const arquivo = join(pasta, modulo, `seed${extensao}`);
    if (!existsSync(arquivo)) {
      continue;
    }
    const exportado = await importarEtapas(arquivo, `modules/${modulo}/seed${extensao}`);
    if (!Array.isArray(exportado) || !exportado.every(ehEtapa)) {
      throw new ErroDoSeedDoModulo(
        `modules/${modulo}/seed${extensao}: exporte etapasDoSeed como lista de {nome, executar}`,
      );
    }
    etapas.push(...exportado);
  }
  return etapas;
}

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
  if (erro instanceof ErroDeConfiguracaoDoBanco || erro instanceof ErroDoSeedDoModulo) {
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
  const conexao = lerConexaoDoBanco(process.env);
  const executadas = await semear(conexao, await carregarEtapas(), process.env);
  const resumo = executadas.length === 0 ? 'nenhuma etapa registrada' : executadas.join(', ');
  process.stdout.write(`db:seed: ${resumo}.\n`);
}

if (import.meta.main) {
  principal().catch((erro: unknown) => {
    process.stderr.write(`db:seed falhou: ${descreverFalha(erro)}\n`);
    process.exitCode = 1;
  });
}
