// Logs Pino em JSON (ADR 0018, specs/014 §Observabilidade). O mesmo logger serve o Fastify
// (requisições, com requestId) e o Nest (boot e mensagens dos módulos).
import type { LoggerService } from '@nestjs/common';
import { type DestinationStream, type Logger, pino } from 'pino';

import type { NivelDeLog } from '../config/env.js';

// Defesa em profundidade: os serializadores padrão do Fastify não logam cabeçalhos, mas se algum
// log incluir a requisição inteira, credenciais e cookies saem mascarados.
const CAMINHOS_REDIGIDOS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
];

export function criarLogger(nivel: NivelDeLog, destino?: DestinationStream): Logger {
  const opcoes = {
    level: nivel,
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: CAMINHOS_REDIGIDOS, censor: '[redigido]' },
  };
  return destino ? pino(opcoes, destino) : pino(opcoes);
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
    this.pino[nivel](campos, typeof mensagem === 'string' ? mensagem : JSON.stringify(mensagem));
  }
}
