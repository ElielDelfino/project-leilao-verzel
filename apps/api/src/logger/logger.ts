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
 * ("Key (email)=(...) already exists"), `parameters` do postgres.js e `params` das consultas.
 */
const CAMPOS_COM_PII: ReadonlySet<string> = new Set(['detail', 'parameters', 'params']);

/** Níveis de objeto copiados abaixo do erro; daí em diante, "[Truncated]" (sem RangeError). */
const PROFUNDIDADE_MAXIMA = 10;

/** Valores que o JSON serializa pelo próprio formato, sem chaves de PII: passam como estão. */
function ehValorBinarioOuData(valor: object): boolean {
  return valor instanceof Date || Buffer.isBuffer(valor) || ArrayBuffer.isView(valor);
}

/** Resultado do toJSON de um objeto, como o JSON.stringify faria; se ele lançar, um marcador. */
function resultadoDoToJson(valor: { toJSON: () => unknown }): unknown {
  try {
    return valor.toJSON();
  } catch {
    // O log não pode cair por um toJSON quebrado; o marcador registra que havia algo ali.
    return '[toJSON falhou]';
  }
}

function temToJson(valor: object): valor is { toJSON: () => unknown } {
  return 'toJSON' in valor && typeof valor.toJSON === 'function';
}

/**
 * Copia o valor sem os campos de PII, até PROFUNDIDADE_MAXIMA. `ancestrais` guarda só o caminho
 * atual: um ciclo vira "[Circular]", e o mesmo objeto em dois ramos é copiado nos dois. Um toJSON
 * próprio é chamado e o resultado também passa pelo filtro, para não contorná-lo.
 */
function semCamposDePii(
  valor: unknown,
  ancestrais: WeakSet<object>,
  profundidade: number,
): unknown {
  if (typeof valor !== 'object' || valor === null || ehValorBinarioOuData(valor)) {
    return valor;
  }
  if (ancestrais.has(valor)) {
    return '[Circular]';
  }
  if (profundidade > PROFUNDIDADE_MAXIMA) {
    return '[Truncated]';
  }
  const filho = (item: unknown): unknown => semCamposDePii(item, ancestrais, profundidade + 1);
  ancestrais.add(valor);
  let copia: unknown;
  if (temToJson(valor)) {
    copia = filho(resultadoDoToJson(valor));
  } else if (Array.isArray(valor)) {
    copia = valor.map(filho);
  } else {
    copia = Object.fromEntries(
      Object.entries(valor)
        .filter(([chave]) => !CAMPOS_COM_PII.has(chave))
        .map(([chave, item]) => [chave, filho(item)]),
    );
  }
  ancestrais.delete(valor);
  return copia;
}

/**
 * Serializador `err`: o padrão do Pino (tipo, mensagem e stack, com as causas) sem os campos em
 * que drivers de banco põem valores da consulta (specs/014: logs sem PII).
 */
export function serializarErro(erro: unknown): unknown {
  const serializado = erro instanceof Error ? pino.stdSerializers.err(erro) : erro;
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
