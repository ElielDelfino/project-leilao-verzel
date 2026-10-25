// Validação do env no boot (specs/014 §Segredos: "A API valida o env com Zod no boot e falha rápido").
// Só entram aqui as variáveis que a API já usa; cada módulo acrescenta as suas quando nascer.
import { z } from 'zod';

import {
  type ConexaoDoBanco,
  ErroDeConfiguracaoDoBanco,
  lerConexaoDoBanco,
} from '../db/conexao.js';
import { type ConexaoDoRedis, criarConexaoDoRedis } from '../redis/conexao.js';
import { ehSegredoCanonico, resolverSegredo } from './segredos.js';

const NIVEIS_DE_LOG = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

const PORTA_MINIMA = 1;
const PORTA_MAXIMA = 65_535;

/** Só dígitos (sem espaço, sinal, expoente ou decimal), como em db/conexao.ts. */
const porta = z
  .string()
  .regex(/^[0-9]{1,5}$/)
  .transform(Number)
  .pipe(z.number().int().min(PORTA_MINIMA).max(PORTA_MAXIMA));
const texto = z.string().min(1);
const segredo = z.string().refine(ehSegredoCanonico);

/**
 * Segredos lidos de <VAR> ou <VAR>_FILE (specs/014 §Leitura). Nesta fase, só as senhas de
 * Postgres e Redis; JWT_SECRET, PSEUDONYM_HMAC_KEY e ED25519_PRIVATE_KEY entram na F1.
 */
const SEGREDOS = ['DB_PASSWORD', 'REDIS_PASSWORD'] as const;
type NomeDoSegredo = (typeof SEGREDOS)[number];

// specs/014 §Conexão: todas obrigatórias e sem default no código; não há DATABASE_URL nem REDIS_URL.
const esquemaDoEnv = z.object({
  API_PORT: z.coerce.number().int().min(PORTA_MINIMA).max(PORTA_MAXIMA),
  LOG_LEVEL: z.enum(NIVEIS_DE_LOG).default('info'),
  POSTGRES_HOST: texto,
  POSTGRES_PORT: porta,
  POSTGRES_DB: texto,
  POSTGRES_USER: texto,
  DB_PASSWORD: segredo,
  REDIS_HOST: texto,
  REDIS_PORT: porta,
  REDIS_PASSWORD: segredo,
});

type VariaveisDoEnv = z.infer<typeof esquemaDoEnv>;
export type NivelDeLog = VariaveisDoEnv['LOG_LEVEL'];

/**
 * Env já validado. As senhas só existem dentro de `postgres` e `redis`, como propriedade não
 * enumerável: um log ou JSON.stringify do env não as expõe.
 */
export interface Env {
  readonly API_PORT: number;
  readonly LOG_LEVEL: NivelDeLog;
  readonly postgres: ConexaoDoBanco;
  readonly redis: ConexaoDoRedis;
}

/** Token de injeção do env já validado. */
export const ENV = Symbol('ENV');

/** Env inválido. A mensagem cita só os nomes das variáveis, nunca os valores recebidos. */
export class ErroDeConfiguracao extends Error {
  override readonly name = 'ErroDeConfiguracao';
}

function ehSegredo(nome: string): nome is NomeDoSegredo {
  return (SEGREDOS as readonly string[]).includes(nome);
}

/**
 * Nome e código do problema. Para um segredo, cita a variável de onde o valor veio (<VAR> ou
 * <VAR>_FILE) e um texto fixo; o `message` do Zod nunca é usado.
 */
function descreverProblema(
  problema: z.core.$ZodIssue,
  origemDoSegredo: Readonly<Partial<Record<NomeDoSegredo, string>>>,
): string {
  const variavel = problema.path.map(String).join('.') || '(raiz)';
  if (ehSegredo(variavel)) {
    const origem = origemDoSegredo[variavel] ?? variavel;
    return `${origem} (fora da forma canônica: 43 caracteres base64url de 32 bytes)`;
  }
  return `${variavel} (${problema.code})`;
}

function falhar(problemas: readonly string[]): never {
  throw new ErroDeConfiguracao(
    `Variáveis de ambiente inválidas ou ausentes: ${problemas.join(', ')}`,
  );
}

/** Monta as conexões; a do Postgres reaproveita a validação de db/conexao.ts. */
function montarEnv(dados: VariaveisDoEnv): Env {
  let postgres: ConexaoDoBanco;
  try {
    postgres = lerConexaoDoBanco({
      POSTGRES_HOST: dados.POSTGRES_HOST,
      POSTGRES_PORT: String(dados.POSTGRES_PORT),
      POSTGRES_DB: dados.POSTGRES_DB,
      POSTGRES_USER: dados.POSTGRES_USER,
      DB_PASSWORD: dados.DB_PASSWORD,
    });
  } catch (erro: unknown) {
    if (erro instanceof ErroDeConfiguracaoDoBanco) {
      falhar(erro.variaveis);
    }
    throw erro;
  }
  return {
    API_PORT: dados.API_PORT,
    LOG_LEVEL: dados.LOG_LEVEL,
    postgres,
    redis: criarConexaoDoRedis(
      { host: dados.REDIS_HOST, port: dados.REDIS_PORT },
      dados.REDIS_PASSWORD,
    ),
  };
}

/**
 * Valida o env e lê os segredos (de <VAR> ou do arquivo de <VAR>_FILE). Qualquer problema lança
 * ErroDeConfiguracao com todos os nomes de uma vez; a API não sobe (specs/014).
 */
export function carregarEnv(origem: Readonly<Record<string, string | undefined>>): Env {
  const problemas: string[] = [];
  const valores: Partial<Record<NomeDoSegredo, string>> = {};
  const origemDoSegredo: Partial<Record<NomeDoSegredo, string>> = {};
  for (const nome of SEGREDOS) {
    const resolvido = resolverSegredo(origem, nome);
    if (resolvido.ok) {
      valores[nome] = resolvido.valor;
      origemDoSegredo[nome] = resolvido.variavel;
    } else {
      problemas.push(resolvido.problema);
    }
  }

  const resultado = esquemaDoEnv.safeParse({ ...origem, ...valores });
  if (!resultado.success) {
    const novos = resultado.error.issues
      // Segredo sem origem válida já tem o problema registrado acima.
      .filter((problema) => {
        const variavel = String(problema.path[0] ?? '');
        return !ehSegredo(variavel) || origemDoSegredo[variavel] !== undefined;
      })
      .map((problema) => descreverProblema(problema, origemDoSegredo));
    problemas.push(...novos);
  }
  if (problemas.length > 0 || !resultado.success) {
    falhar(problemas);
  }
  return montarEnv(resultado.data);
}
