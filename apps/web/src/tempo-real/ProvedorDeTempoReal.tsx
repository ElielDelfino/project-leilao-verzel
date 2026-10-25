import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { io } from 'socket.io-client';

import {
  ContextoDeTempoReal,
  type EstadoDaConexao,
  type SocketDoApp,
  type TempoReal,
} from './contexto';

/** Namespace, transporte e credenciais de specs/009: só websocket, mesmo origin, cookie. */
export function criarSocketDoLeilao(): SocketDoApp {
  return io('/leilao', { transports: ['websocket'], withCredentials: true });
}

interface Props {
  children: ReactNode;
  /** Fábrica do socket; os testes injetam um servidor Socket.IO falso. */
  criarSocket?: () => SocketDoApp;
}

/**
 * Dona do socket do app: abre ao montar, fecha ao desmontar (seguro sob StrictMode) e expõe o
 * estado da conexão. A reconexão é do próprio socket.io; quem entra em rooms refaz o `entrar`
 * a cada evento `connect`.
 */
export function ProvedorDeTempoReal({ children, criarSocket = criarSocketDoLeilao }: Props) {
  const [socket, setSocket] = useState<SocketDoApp | null>(null);
  const [conexao, setConexao] = useState<EstadoDaConexao>('conectando');

  useEffect(() => {
    const novo = criarSocket();
    let jaConectou = novo.connected;
    const aoConectar = () => {
      jaConectou = true;
      setConexao('conectado');
    };
    const aoPerder = () => setConexao(jaConectou ? 'reconectando' : 'conectando');
    novo.on('connect', aoConectar);
    novo.on('disconnect', aoPerder);
    novo.on('connect_error', aoPerder);
    setConexao(novo.connected ? 'conectado' : 'conectando');
    setSocket(novo);
    return () => {
      novo.off('connect', aoConectar);
      novo.off('disconnect', aoPerder);
      novo.off('connect_error', aoPerder);
      novo.close();
      setSocket(null);
    };
  }, [criarSocket]);

  const valor = useMemo<TempoReal>(() => ({ socket, conexao }), [socket, conexao]);
  return <ContextoDeTempoReal value={valor}>{children}</ContextoDeTempoReal>;
}
