// Logs Pino em JSON (ADR 0018, specs/014 §Observabilidade). O mesmo logger serve o Fastify
// (requisições, com requestId) e o Nest (boot e mensagens dos módulos).
import type { LoggerService } from '@nestjs/common';
import { type DestinationStream, type Logger, pino } from 'pino';

import type { NivelDeLog } from '../config/env.js';

/** O que o serializador usa da requisição do Fastify. */
interface RequisicaoLogavel {
  readonly method?: string;
  readonly url?: string;
}

export interface RequisicaoSerializada {
  readonly method: string | undefined;
  readonly url: string | undefined;
}

/**
 * Serializador `req`: só método e caminho. A query string fica de fora (pode levar token ou
 * e-mail), assim como cabeçalhos, IP e porta (specs/014: logs sem PII). O Fastify dá
 * precedência aos serializadores do logger recebido em `loggerInstance`.
 */
export function serializarRequisicao(requisicao: RequisicaoLogavel): RequisicaoSerializada {
  const url = requisicao.url;
  return { method: requisicao.method, url: url === undefined ? undefined : url.split('?', 1)[0] };
}

/**
 * Campos que drivers de banco põem nos erros com valores da consulta (PII): `detail` do pg
 * ("Key (email)=(...) already exists"), `where` e `internalQuery` do pg (contexto e consulta
 * interna, que podem repetir valores), `parameters` do postgres.js e `params` das consultas.
 */
const CAMPOS_COM_PII: ReadonlySet<string> = new Set([
  'detail',
  'where',
  'internalQuery',
  'parameters',
  'params',
]);

/** Níveis de objeto copiados abaixo do erro; daí em diante, "[Truncated]" (sem RangeError). */
const PROFUNDIDADE_MAXIMA = 10;

/** Marcador de um campo cuja leitura lançou (getter quebrado). */
const ERRO_AO_LER = '[erro ao ler]';

/** %TypedArray%.prototype: pai comum de Uint8Array.prototype, Int32Array.prototype etc. */
const PROTOTIPO_DE_TYPED_ARRAY: unknown = Object.getPrototypeOf(Uint8Array.prototype);

const INDICE = /^(?:0|[1-9][0-9]*)$/;

type Leitura = { readonly ok: true; readonly valor: unknown } | { readonly ok: false };

/** Lê um campo sem deixar um getter que lança derrubar o log (o filtro do Nest não protege). */
function ler(objeto: object, chave: PropertyKey): Leitura {
  try {
    return { ok: true, valor: (objeto as Record<PropertyKey, unknown>)[chave] };
  } catch {
    return { ok: false };
  }
}

function somenteIndices(valor: object): boolean {
  return Reflect.ownKeys(valor).every((chave) => typeof chave === 'string' && INDICE.test(chave));
}

/**
 * Date, Buffer e TypedArray que o JSON serializa pelo formato nativo, sem chaves de PII: só os de
 * protótipo nativo (sem subclasse) e sem chave própria além dos índices. Um toJSON próprio, ou uma
 * chave extra num TypedArray (que o JSON incluiria), leva o valor ao filtro.
 */
function ehNativoSemExtras(valor: object): boolean {
  const prototipo: unknown = Object.getPrototypeOf(valor);
  if (prototipo === Date.prototype) {
    return Reflect.ownKeys(valor).length === 0;
  }
  const ehTypedArrayNativo =
    prototipo === Buffer.prototype ||
    (prototipo !== null && Object.getPrototypeOf(prototipo) === PROTOTIPO_DE_TYPED_ARRAY);
  return ehTypedArrayNativo && somenteIndices(valor);
}

/** Resultado do toJSON de um objeto, como o JSON.stringify faria; se ele lançar, um marcador. */
function resultadoDoToJson(valor: object, toJson: () => unknown): unknown {
  try {
    return toJson.call(valor);
  } catch {
    // O log não pode cair por um toJSON quebrado; o marcador registra que havia algo ali.
    return '[toJSON falhou]';
  }
}

type Filho = (leitura: Leitura) => unknown;

function copiarArray(valor: readonly unknown[], filho: Filho): unknown[] {
  return Array.from({ length: valor.length }, (_, indice) => filho(ler(valor, indice)));
}

function copiarObjeto(valor: object, filho: Filho): Record<string, unknown> {
  return Object.fromEntries(
    Object.keys(valor)
      .filter((chave) => !CAMPOS_COM_PII.has(chave))
      .map((chave) => [chave, filho(ler(valor, chave))]),
  );
}

/**
 * Copia o valor sem os campos de PII, até PROFUNDIDADE_MAXIMA. `ancestrais` guarda só o caminho
 * atual: um ciclo vira "[Circular]", e o mesmo objeto em dois ramos é copiado nos dois. Um toJSON
 * próprio é chamado e o resultado também passa pelo filtro, para não contorná-lo. Cada campo é lido
 * à parte: um getter que lança vira "[erro ao ler]".
 */
function semCamposDePii(
  valor: unknown,
  ancestrais: WeakSet<object>,
  profundidade: number,
): unknown {
  if (typeof valor !== 'object' || valor === null || ehNativoSemExtras(valor)) {
    return valor;
  }
  if (ancestrais.has(valor)) {
    return '[Circular]';
  }
  if (profundidade > PROFUNDIDADE_MAXIMA) {
    return '[Truncated]';
  }
  const filho: Filho = (leitura) =>
    leitura.ok ? semCamposDePii(leitura.valor, ancestrais, profundidade + 1) : ERRO_AO_LER;
  const toJson = ler(valor, 'toJSON');
  if (!toJson.ok) {
    return ERRO_AO_LER;
  }
  ancestrais.add(valor);
  let copia: unknown;
  if (typeof toJson.valor === 'function') {
    copia = filho({ ok: true, valor: resultadoDoToJson(valor, toJson.valor as () => unknown) });
  } else if (Array.isArray(valor)) {
    copia = copiarArray(valor, filho);
  } else {
    copia = copiarObjeto(valor, filho);
  }
  ancestrais.delete(valor);
  return copia;
}

function valorLido(objeto: object, chave: PropertyKey): unknown {
  const leitura = ler(objeto, chave);
  return leitura.ok ? leitura.valor : ERRO_AO_LER;
}

/**
 * Para quando o serializador do Pino lança (getter quebrado no erro): tipo, mensagem, stack,
 * campos próprios e causa, cada um lido à parte.
 */
function serializarErroComCuidado(erro: Error): Record<string, unknown> {
  const tipo = valorLido(erro.constructor, 'name');
  const base: Record<string, unknown> = {
    type: typeof tipo === 'string' ? tipo : 'Error',
    message: valorLido(erro, 'message'),
    stack: valorLido(erro, 'stack'),
  };
  const campos = Object.keys(erro)
    .filter((chave) => !(chave in base))
    .map((chave): [string, unknown] => {
      const valor = valorLido(erro, chave);
      return [chave, valor instanceof Error ? serializarErro(valor) : valor];
    });
  const causa = valorLido(erro, 'cause');
  return {
    ...base,
    ...Object.fromEntries(campos),
    ...(causa === undefined
      ? {}
      : { cause: causa instanceof Error ? serializarErro(causa) : causa }),
  };
}

function serializarComPino(erro: Error): unknown {
  try {
    return pino.stdSerializers.err(erro);
  } catch {
    return serializarErroComCuidado(erro);
  }
}

/**
 * Serializador `err`: o padrão do Pino (tipo, mensagem e stack, com as causas) sem os campos em
 * que drivers de banco põem valores da consulta (specs/014: logs sem PII). Não reescreve a
 * `message`: erros do driver chegam aqui já convertidos por db/erros.ts (o DrizzleQueryError traz
 * "Failed query: <sql>\nparams: <valores>" na mensagem e nunca sai de src/db/ cru).
 */
export function serializarErro(erro: unknown): unknown {
  const serializado = erro instanceof Error ? serializarComPino(erro) : erro;
  return semCamposDePii(serializado, new WeakSet(), 0);
}

export function criarLogger(nivel: NivelDeLog, destino?: DestinationStream): Logger {
  const opcoes = {
    level: nivel,
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: { req: serializarRequisicao, err: serializarErro },
  };
  return destino ? pino(opcoes, destino) : pino(opcoes);
}

/** Converte a mensagem do Nest em texto sem lançar (BigInt e referência circular quebram o JSON). */
function paraTexto(valor: unknown): string {
  if (typeof valor === 'string') {
    return valor;
  }
  if (typeof valor === 'bigint') {
    return valor.toString();
  }
  try {
    return JSON.stringify(valor) ?? String(valor);
  } catch {
    // Valor não serializável: registra o tipo em vez de derrubar quem estava logando.
    return Object.prototype.toString.call(valor);
  }
}

type NivelDoPino = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

/** Mesmo critério do ConsoleLogger do Nest 12 (isStackFormat) para reconhecer um stack. */
const FORMATO_DE_STACK = /\n[ \t]+at .+:\d+:\d+/;

/**
 * Separa stack e contexto de `error/fatal(mensagem, ...parametros)`, como o ConsoleLogger do Nest:
 * com dois ou mais parâmetros, são (stack, contexto); com um só, ele é o stack se tiver o formato
 * de stack, senão é o contexto.
 */
function stackEContexto(parametros: readonly unknown[]): { stack?: string; contexto?: string } {
  const [primeiro, segundo] = parametros;
  const [stack, contexto] =
    parametros.length >= 2 || (typeof primeiro === 'string' && FORMATO_DE_STACK.test(primeiro))
      ? [primeiro, segundo]
      : [undefined, primeiro];
  return {
    ...(typeof contexto === 'string' ? { contexto } : {}),
    ...(typeof stack === 'string' ? { stack } : {}),
  };
}

/** Adapta o Pino à interface de logger do Nest: `log(mensagem, ...parametros, contexto?)`. */
export class LoggerNestPino implements LoggerService {
  constructor(private readonly logger: Logger) {}

  log(mensagem: unknown, ...parametros: unknown[]): void {
    this.escrever('info', mensagem, parametros);
  }

  warn(mensagem: unknown, ...parametros: unknown[]): void {
    this.escrever('warn', mensagem, parametros);
  }

  debug(mensagem: unknown, ...parametros: unknown[]): void {
    this.escrever('debug', mensagem, parametros);
  }

  verbose(mensagem: unknown, ...parametros: unknown[]): void {
    this.escrever('trace', mensagem, parametros);
  }

  /** O Nest chama `fatal(mensagem, stack?, contexto?)`, como em error. */
  fatal(mensagem: unknown, ...parametros: unknown[]): void {
    this.emitir('fatal', mensagem, stackEContexto(parametros));
  }

  /** O Nest chama `error(mensagem, stack?, contexto?)`. */
  error(mensagem: unknown, ...parametros: unknown[]): void {
    this.emitir('error', mensagem, stackEContexto(parametros));
  }

  private escrever(nivel: NivelDoPino, mensagem: unknown, parametros: readonly unknown[]): void {
    const ultimo = parametros.at(-1);
    this.emitir(nivel, mensagem, typeof ultimo === 'string' ? { contexto: ultimo } : {});
  }

  private emitir(nivel: NivelDoPino, mensagem: unknown, campos: object): void {
    if (mensagem instanceof Error) {
      this.logger[nivel]({ ...campos, err: mensagem }, mensagem.message);
      return;
    }
    this.logger[nivel](campos, paraTexto(mensagem));
  }
}
