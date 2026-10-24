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

export function criarLogger(nivel: NivelDeLog, destino?: DestinationStream): Logger {
  const opcoes = {
    level: nivel,
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: { req: serializarRequisicao },
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

/** Adapta o Pino à interface de logger do Nest: `log(mensagem, ...parametros, contexto?)`. */
export class LoggerNestPino implements LoggerService {
  constructor(private readonly pino: Logger) {}

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

  fatal(mensagem: unknown, ...parametros: unknown[]): void {
    this.escrever('fatal', mensagem, parametros);
  }

  /** O Nest chama `error(mensagem, stack?, contexto?)`. */
  error(mensagem: unknown, ...parametros: unknown[]): void {
    const [stack, contexto] = parametros.length >= 2 ? parametros : [undefined, ...parametros];
    const campos = {
      ...(typeof contexto === 'string' ? { contexto } : {}),
      ...(typeof stack === 'string' ? { stack } : {}),
    };
    this.emitir('error', mensagem, campos);
  }

  private escrever(nivel: NivelDoPino, mensagem: unknown, parametros: readonly unknown[]): void {
    const ultimo = parametros.at(-1);
    this.emitir(nivel, mensagem, typeof ultimo === 'string' ? { contexto: ultimo } : {});
  }

  private emitir(nivel: NivelDoPino, mensagem: unknown, campos: object): void {
    if (mensagem instanceof Error) {
      this.pino[nivel]({ ...campos, err: mensagem }, mensagem.message);
      return;
    }
    this.pino[nivel](campos, paraTexto(mensagem));
  }
}
