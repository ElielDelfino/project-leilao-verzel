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

/**
 * Copia o valor sem os campos de PII, em qualquer profundidade. `ancestrais` guarda só o caminho
 * atual: um ciclo vira "[Circular]", e o mesmo objeto em dois ramos é copiado nos dois.
 */
function semCamposDePii(valor: unknown, ancestrais: WeakSet<object>): unknown {
  // Date, Buffer e afins se serializam pelo próprio toJSON; copiar as chaves os esvaziaria.
  if (typeof valor !== 'object' || valor === null || 'toJSON' in valor) {
    return valor;
  }
  if (ancestrais.has(valor)) {
    return '[Circular]';
  }
  ancestrais.add(valor);
  const copia = Array.isArray(valor)
    ? valor.map((item: unknown) => semCamposDePii(item, ancestrais))
    : Object.fromEntries(
        Object.entries(valor)
          .filter(([chave]) => !CAMPOS_COM_PII.has(chave))
          .map(([chave, item]) => [chave, semCamposDePii(item, ancestrais)]),
      );
  ancestrais.delete(valor);
  return copia;
}

/**
 * Serializador `err`: o padrão do Pino (tipo, mensagem e stack, com as causas) sem os campos em
 * que drivers de banco põem valores da consulta (specs/014: logs sem PII).
 */
export function serializarErro(erro: unknown): unknown {
  const serializado = erro instanceof Error ? pino.stdSerializers.err(erro) : erro;
  return semCamposDePii(serializado, new WeakSet());
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
