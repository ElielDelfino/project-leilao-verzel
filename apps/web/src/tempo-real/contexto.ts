import type { EventosDoServidor } from '@leilao/contracts';
import { createContext, useContext } from 'react';

/** Superfície mínima do socket que o app usa; o `Socket` do socket.io-client a satisfaz. */
export interface SocketDoApp {
  readonly connected: boolean;
  on(evento: string, ouvinte: (...args: never[]) => void): unknown;
  off(evento: string, ouvinte?: (...args: never[]) => void): unknown;
  emit(evento: string, ...args: unknown[]): unknown;
  /** Como `emit`, mas o último argumento (ack) recebe `(erro, resposta)`; `erro` vem no timeout. */
  timeout(ms: number): { emit(evento: string, ...args: unknown[]): unknown };
  close(): unknown;
}

export type EstadoDaConexao = 'conectando' | 'conectado' | 'reconectando';

export interface TempoReal {
  /** Null enquanto o provedor ainda não criou o socket (primeiro render). */
  socket: SocketDoApp | null;
  conexao: EstadoDaConexao;
}

export type NomeDeEvento = keyof EventosDoServidor;

export const ContextoDeTempoReal = createContext<TempoReal>({
  socket: null,
  conexao: 'conectando',
});

export function useTempoReal(): TempoReal {
  return useContext(ContextoDeTempoReal);
}
