import type { EventosDoServidor } from '@leilao/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { aplicarFimEstendido, aplicarLanceAceito, invalidarVitrine } from './cacheDaVitrine';
import { useTempoReal } from './contexto';

/**
 * Mantém a lista da vitrine ao vivo (specs/009 §Vitrine): entra no room `vitrine`, aplica os
 * eventos no cache e, a cada (re)conexão, refaz a consulta (resync). Ao desmontar, sai do room
 * e remove todos os ouvintes.
 */
export function useVitrineAoVivo(): void {
  const queryClient = useQueryClient();
  const { socket } = useTempoReal();

  useEffect(() => {
    if (!socket) return;

    const entrar = () => socket.emit('entrar_vitrine');
    const aoConectar = () => {
      entrar();
      void invalidarVitrine(queryClient);
    };
    const aoLance = (evento: EventosDoServidor['lance_aceito']) =>
      aplicarLanceAceito(queryClient, evento);
    const aoFimEstendido = (evento: EventosDoServidor['fim_estendido']) =>
      aplicarFimEstendido(queryClient, evento);
    const aoMudarDeAba = () => void invalidarVitrine(queryClient);

    socket.on('connect', aoConectar);
    socket.on('lance_aceito', aoLance);
    socket.on('fim_estendido', aoFimEstendido);
    socket.on('lote_iniciado', aoMudarDeAba);
    socket.on('lote_encerrado', aoMudarDeAba);
    socket.on('lote_cancelado', aoMudarDeAba);
    // Já conectado ao montar: o evento `connect` não virá de novo.
    if (socket.connected) entrar();

    return () => {
      socket.off('connect', aoConectar);
      socket.off('lance_aceito', aoLance);
      socket.off('fim_estendido', aoFimEstendido);
      socket.off('lote_iniciado', aoMudarDeAba);
      socket.off('lote_encerrado', aoMudarDeAba);
      socket.off('lote_cancelado', aoMudarDeAba);
      if (socket.connected) socket.emit('sair_vitrine');
    };
  }, [socket, queryClient]);
}
