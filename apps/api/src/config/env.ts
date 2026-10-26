// Validação do env no boot (specs/014 §Segredos: "A API valida o env com Zod no boot e falha rápido").
// Só entram aqui as variáveis que a API já usa; cada módulo acrescenta as suas quando nascer.
import { z } from 'zod';

import {
  type ConexaoDoBanco,
  ErroDeConfiguracaoDoBanco,
  lerConexaoDoBanco,
  VARIAVEIS_DA_API,
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
 * Segredos que a API lê de <VAR> ou <VAR>_FILE (specs/014 §Leitura e §Conexão). A API conecta
 * como o papel `leilao_api` (DB_API_PASSWORD) e não lê DB_PASSWORD, que é do dono (ADR 0026).
 */
const SEGREDOS = [
  'DB_API_PASSWORD',
  'REDIS_PASSWORD',
  'JWT_SECRET',
  'PSEUDONYM_HMAC_KEY',
  'ED25519_PRIVATE_KEY',
] as const;
type NomeDoSegredo = (typeof SEGREDOS)[number];

/**
 * Origem da SPA: só http:// ou https:// seguido de host (specs/003 §Cookies, ADR 0027), e uma URL
 * que o `new URL` aceita (a regex sozinha deixa passar `http://[bad`).
 */
const origemWeb = z
  .string()
  .regex(/^https?:\/\/[^\s/?#]+$/)
  .refine((valor) => URL.canParse(valor));

const GRUPOS_IPV6 = 8;
const BITS_POR_GRUPO = 16;
const MASCARA_DO_GRUPO = 0xff_ff;
const PRIMEIRO_OCTETO_LOOPBACK = 127;
const BITS_DO_PRIMEIRO_OCTETO = 24;

/** 127.0.0.0/8 ou 0.0.0.0, para um IPv4 em 32 bits. */
function ehIpv4Local(endereco: number): boolean {
  return endereco === 0 || endereco >>> BITS_DO_PRIMEIRO_OCTETO === PRIMEIRO_OCTETO_LOOPBACK;
}

/**
 * Os 8 grupos de um IPv6 já normalizado pelo `new URL` (sem colchetes, minúsculo e com o IPv4
 * final reescrito em hexadecimal, como `::ffff:7f00:1`). Fora desse formato devolve null.
 */
function expandirIpv6(endereco: string): readonly number[] | null {
  const [inicio = '', fim, ...resto] = endereco.split('::');
  if (resto.length > 0) {
    return null;
  }
  const paraGrupos = (parte: string): number[] =>
    parte === '' ? [] : parte.split(':').map((grupo) => Number.parseInt(grupo, 16));
  const esquerda = paraGrupos(inicio);
  const direita = fim === undefined ? [] : paraGrupos(fim);
  const zeros = GRUPOS_IPV6 - esquerda.length - direita.length;
  if (zeros < 0 || (fim === undefined && zeros !== 0)) {
    return null;
  }
  const grupos = [...esquerda, ...Array<number>(zeros).fill(0), ...direita];
  return grupos.every((grupo) => Number.isInteger(grupo) && grupo >= 0 && grupo <= MASCARA_DO_GRUPO)
    ? grupos
    : null;
}

/**
 * `::`, `::1` e o IPv4 local mapeado (`::ffff:a.b.c.d`) ou embutido (`::a.b.c.d`). Um IPv6
 * público que só termina como 127.x (`2001:db8::7f00:1`) não conta.
 */
function ehIpv6Local(endereco: string): boolean {
  const grupos = expandirIpv6(endereco);
  if (grupos === null) {
    return false;
  }
  const prefixoZerado = grupos.slice(0, 5).every((grupo) => grupo === 0);
  const sexto = grupos[5];
  if (!prefixoZerado || (sexto !== 0 && sexto !== MASCARA_DO_GRUPO)) {
    return false;
  }
  const [alto = 0, baixo = 0] = grupos.slice(6);
  const ipv4 = ((alto << BITS_POR_GRUPO) | baixo) >>> 0;
  // Com o sexto grupo zerado, 0.0.0.0 é `::` e 0.0.0.1 é `::1`; os dois são locais.
  return ehIpv4Local(ipv4) || (sexto === 0 && ipv4 === 1);
}

/**
 * Host de loopback ou não especificado: `localhost` e `*.localhost` (com ou sem ponto final),
 * 127.0.0.0/8, 0.0.0.0, `::`, `::1` e esses IPv4 em IPv6. Em produção a origem da SPA é o host
 * público (specs/014 §Conexão); com um destes, a checagem de origem em CORS, CSRF e Socket.IO não
 * protegeria nada (tarefa 020). Recebe só origens que passaram em `origemWeb` (URL válida).
 */
function ehOrigemLocal(origem: string): boolean {
  const host = new URL(origem).hostname.toLowerCase().replace(/\.$/, '');
  if (host.startsWith('[')) {
    return ehIpv6Local(host.slice(1, -1));
  }
  // O `new URL` já reescreve um IPv4 em quatro octetos decimais (`127.1` vira `127.0.0.1`).
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '0.0.0.0' ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
  );
}

/** Base da API da Scryfall: `http(s)://host[:porta]`, sem caminho nem barra final (specs/005). */
const SCRYFALL_BASE_URL_PADRAO = 'https://api.scryfall.com';
const MAX_USER_AGENT = 200;
/** ASCII imprimível, sem controle (um header não pode levar quebra de linha). */
const userAgent = z
  .string()
  .min(1)
  .max(MAX_USER_AGENT)
  .regex(/^[\x20-\x7E]+$/);

/**
 * Prefixo Redis próprio da Scryfall, só para teste e e2e: `scryfall:` + `e2e` ou `t` + letras
 * minúsculas, dígitos e hífen, terminando em `:` (mesma regra de test/helpers/app-de-teste.ts).
 */
const prefixoRedisDeTeste = z.string().regex(/^scryfall:(?:e2e|t)[a-z0-9-]*:$/);

// specs/014 §Conexão: todas obrigatórias e sem default no código; não há DATABASE_URL nem REDIS_URL.
const esquemaDoEnv = z.object({
  API_PORT: z.coerce.number().int().min(PORTA_MINIMA).max(PORTA_MAXIMA),
  LOG_LEVEL: z.enum(NIVEIS_DE_LOG).default('info'),
  POSTGRES_HOST: texto,
  POSTGRES_PORT: porta,
  POSTGRES_DB: texto,
  POSTGRES_API_USER: texto,
  DB_API_PASSWORD: segredo,
  REDIS_HOST: texto,
  REDIS_PORT: porta,
  REDIS_PASSWORD: segredo,
  JWT_SECRET: segredo,
  PSEUDONYM_HMAC_KEY: segredo,
  ED25519_PRIVATE_KEY: segredo,
  WEB_ORIGIN: origemWeb,
  SCRYFALL_USER_AGENT: userAgent,
  SCRYFALL_BASE_URL: origemWeb.default(SCRYFALL_BASE_URL_PADRAO),
  SCRYFALL_REDIS_PREFIX: prefixoRedisDeTeste.optional(),
});

type VariaveisDoEnv = z.infer<typeof esquemaDoEnv>;
export type NivelDeLog = VariaveisDoEnv['LOG_LEVEL'];

/**
 * Chaves da API, já decodificadas (32 bytes cada; specs/014 §Segredos). As três propriedades
 * são não enumeráveis: JSON.stringify, spread e util.inspect não as mostram.
 */
export interface SegredosDaApi {
  /** Chave HS256 do access token: os 32 bytes de JWT_SECRET (specs/003). */
  readonly chaveJwt: Uint8Array;
  /** Chave HMAC-SHA256 dos pseudônimos (specs/008), de PSEUDONYM_HMAC_KEY. */
  readonly chavePseudonimo: Uint8Array;
  /** Seed Ed25519 (RFC 8032 §5.1.5) de ED25519_PRIVATE_KEY (specs/008). */
  readonly sementeEd25519: Uint8Array;
}

/**
 * Env já validado. Senhas e chaves só existem dentro de `postgres`, `redis` e `segredos`, como
 * propriedade não enumerável: um log ou JSON.stringify do env não as expõe.
 */
export interface Env {
  readonly API_PORT: number;
  readonly LOG_LEVEL: NivelDeLog;
  readonly postgres: ConexaoDoBanco;
  readonly redis: ConexaoDoRedis;
  /** Origem da SPA (specs/014 §Conexão). */
  readonly WEB_ORIGIN: string;
  /** `Secure` nos cookies: WEB_ORIGIN começa com https:// (specs/003 §Cookies, ADR 0027). */
  readonly cookiesSeguros: boolean;
  readonly segredos: SegredosDaApi;
  /** Cliente da Scryfall (specs/005 §Cliente HTTP). */
  readonly scryfall: ConfigDaScryfallNoEnv;
  /**
   * NODE_ENV=production. Opcional para os Env montados à mão nos testes (ausente = fora de
   * produção); carregarEnv sempre o preenche.
   */
  readonly producao?: boolean;
}

/**
 * Prefixo padrão das chaves Redis da Scryfall (cache/redis/README.md). Só teste e e2e o trocam,
 * por SCRYFALL_REDIS_PREFIX (rejeitada em produção) ou pela app de teste.
 */
export const PREFIXO_REDIS_DA_SCRYFALL = 'scryfall:';

export interface ConfigDaScryfallNoEnv extends ConfigDaScryfall {
  /**
   * Prefixo das chaves Redis do cliente: PREFIXO_REDIS_DA_SCRYFALL, sempre em produção. Fora dela,
   * SCRYFALL_REDIS_PREFIX (formato fechado) ou o da app de teste, próprio por app, para que
   * arquivos paralelos e o e2e não disputem bucket, circuito e cache com o dev (tarefas 067, 099).
   */
  readonly prefixoRedis: string;
}

export interface ConfigDaScryfall {
  /** Header `User-Agent` de toda chamada (SCRYFALL_USER_AGENT). */
  readonly userAgent: string;
  /** Origem da API, sem barra final (SCRYFALL_BASE_URL; só teste e e2e a sobrescrevem). */
  readonly baseUrl: string;
}

/** Monta SegredosDaApi com as chaves não enumeráveis. */
export function criarSegredosDaApi(chaves: SegredosDaApi): SegredosDaApi {
  const segredos = {};
  for (const [nome, valor] of Object.entries(chaves)) {
    Object.defineProperty(segredos, nome, { value: valor, enumerable: false });
  }
  return Object.freeze(segredos) as SegredosDaApi;
}

function decodificar(valor: string): Uint8Array {
  return new Uint8Array(Buffer.from(valor, 'base64url'));
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
function montarEnv(dados: VariaveisDoEnv, producao: boolean): Env {
  let postgres: ConexaoDoBanco;
  try {
    postgres = lerConexaoDoBanco(
      {
        POSTGRES_HOST: dados.POSTGRES_HOST,
        POSTGRES_PORT: String(dados.POSTGRES_PORT),
        POSTGRES_DB: dados.POSTGRES_DB,
        POSTGRES_API_USER: dados.POSTGRES_API_USER,
        DB_API_PASSWORD: dados.DB_API_PASSWORD,
      },
      VARIAVEIS_DA_API,
    );
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
    WEB_ORIGIN: dados.WEB_ORIGIN,
    cookiesSeguros: dados.WEB_ORIGIN.startsWith('https://'),
    segredos: criarSegredosDaApi({
      chaveJwt: decodificar(dados.JWT_SECRET),
      chavePseudonimo: decodificar(dados.PSEUDONYM_HMAC_KEY),
      sementeEd25519: decodificar(dados.ED25519_PRIVATE_KEY),
    }),
    scryfall: Object.freeze({
      userAgent: dados.SCRYFALL_USER_AGENT,
      baseUrl: dados.SCRYFALL_BASE_URL,
      prefixoRedis: dados.SCRYFALL_REDIS_PREFIX ?? PREFIXO_REDIS_DA_SCRYFALL,
    }),
    producao,
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

  const producao = origem.NODE_ENV === 'production';
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
  // Em produção o prefixo nunca difere do padrão: a variável é rejeitada, qualquer que seja o valor.
  if (producao && origem.SCRYFALL_REDIS_PREFIX !== undefined) {
    problemas.push('SCRYFALL_REDIS_PREFIX (proibida em produção)');
  }
  // `*` já não passa no formato; em produção o loopback também é recusado (tarefa 020).
  if (producao && resultado.success && ehOrigemLocal(resultado.data.WEB_ORIGIN)) {
    problemas.push('WEB_ORIGIN (localhost ou loopback proibido em produção)');
  }
  if (problemas.length > 0 || !resultado.success) {
    falhar(problemas);
  }
  return montarEnv(resultado.data, producao);
}
