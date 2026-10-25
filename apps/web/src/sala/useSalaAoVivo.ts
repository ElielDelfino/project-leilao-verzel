import type { EventosDoServidor } from '@leilao/contracts';
import { useEffect, useRef, useState } from 'react';

import { useTempoReal } from '../tempo-real/contexto';
import { interpretarAck } from './ackDeEntrada';
import {
  aplicarCancelado,
  aplicarEncerrado,
  aplicarFimEstendido,
  aplicarIniciado,
  aplicarLance,
  aplicarSuperado,
  criarEstadoDaSala,
  type EstadoDaSala,
} from './estadoDaSala';

import type { CodigoDeErroDaSala } from './tiposDoServidor';

export type { CodigoDeErroDaSala };

/** Sem nenhum evento por este tempo numa sala ao vivo, o cliente refaz o `entrar_lote` (specs/009). */
export const INTERVALO_DO_RESYNC_MS = 30_000;
/** Duração do selo "Fim estendido" (specs/012). */
export const DURACAO_DO_SELO_MS = 10_000;
/** Espera máxima pelo ack do `entrar_lote`; passado isso a entrada conta como falha. */
export const TIMEOUT_DA_ENTRADA_MS = 5_000;
/** Sem conexão e sem estado por este tempo, a tela de carregamento vira erro de rede. */
export const PRAZO_SEM_ESTADO_MS = 10_000;

export interface SalaAoVivo {
  estado: EstadoDaSala | null;
  erro: CodigoDeErroDaSala | null;
  /** Conexão perdida ou entrada sem resposta; some quando o novo `entrar_lote` responde. */
  reconectando: boolean;
  seloDeFimEstendido: boolean;
  tentarDeNovo: () => void;
}

/**
 * Entra no room do lote, mantém o estado pelos eventos e refaz o `entrar_lote` a cada
 * (re)conexão e, numa sala ao vivo, quando 30 s passam sem evento. Sai do room ao desmontar.
 */
export function useSalaAoVivo(loteId: string): SalaAoVivo {
  const { socket } = useTempoReal();
  const [estado, setEstado] = useState<EstadoDaSala | null>(null);
  const [erro, setErro] = useState<CodigoDeErroDaSala | null>(null);
  const [reconectando, setReconectando] = useState(false);
  const [seloDeFimEstendido, setSelo] = useState(false);
  const [tentativa, setTentativa] = useState(0);
  // Fonte da verdade síncrona do estado: só os callbacks do efeito a escrevem (nunca o render).
  const estadoRef = useRef<EstadoDaSala | null>(null);

  useEffect(() => {
    if (!socket) return;
    let ativo = true;
    // Cada `entrar_lote` leva um número; só o ack da requisição mais recente vale.
    let geracao = 0;
    let temporizadorDoResync: ReturnType<typeof setTimeout> | undefined;
    let temporizadorDoSelo: ReturnType<typeof setTimeout> | undefined;
    let temporizadorDoPrazo: ReturnType<typeof setTimeout> | undefined;

    const publicar = (novo: EstadoDaSala) => {
      estadoRef.current = novo;
      setEstado(novo);
    };
    /** Aplica a transformação ao estado atual; devolve se algo mudou. */
    const atualizar = (transformar: (anterior: EstadoDaSala) => EstadoDaSala): boolean => {
      const atual = estadoRef.current;
      if (!atual) return false;
      const novo = transformar(atual);
      if (novo === atual) return false;
      publicar(novo);
      return true;
    };

    const limparPrazo = () => {
      clearTimeout(temporizadorDoPrazo);
      temporizadorDoPrazo = undefined;
    };
    const iniciarPrazo = () => {
      if (temporizadorDoPrazo !== undefined || estadoRef.current) return;
      temporizadorDoPrazo = setTimeout(() => {
        temporizadorDoPrazo = undefined;
        if (!estadoRef.current) setErro('INDISPONIVEL');
      }, PRAZO_SEM_ESTADO_MS);
    };

    const agendarResync = () => {
      clearTimeout(temporizadorDoResync);
      temporizadorDoResync = setTimeout(() => {
        if (estadoRef.current?.lote.status === 'ao_vivo') entrar();
        else agendarResync();
      }, INTERVALO_DO_RESYNC_MS);
    };

    const aoReceberAck = (falhou: unknown, ack: unknown) => {
      if (falhou) {
        // Timeout: sem estado vira erro com "Tentar de novo"; com estado a sala segue e avisa.
        setReconectando(true);
        if (!estadoRef.current) setErro('INDISPONIVEL');
        return;
      }
      limparPrazo();
      setReconectando(false);
      const resultado = interpretarAck(ack);
      if (resultado.sucesso) {
        setErro(null);
        publicar(criarEstadoDaSala(resultado.estado, Date.now()));
      } else {
        setErro(resultado.codigo);
      }
    };

    const entrar = () => {
      geracao += 1;
      const minha = geracao;
      socket
        .timeout(TIMEOUT_DA_ENTRADA_MS)
        .emit('entrar_lote', { loteId }, (falhou: unknown, ack: unknown) => {
          if (!ativo || minha !== geracao) return;
          aoReceberAck(falhou, ack);
          agendarResync();
        });
    };

    const doLote = <E extends { loteId: string }>(tratar: (evento: E) => void) => {
      return (evento: E) => {
        if (evento.loteId !== loteId) return;
        agendarResync();
        tratar(evento);
      };
    };

    const aoLance = doLote((e: EventosDoServidor['lance_aceito']) =>
      atualizar((s) => aplicarLance(s, e)),
    );
    const aoFimEstendido = doLote((e: EventosDoServidor['fim_estendido']) => {
      if (!atualizar((s) => aplicarFimEstendido(s, e))) return;
      setSelo(true);
      clearTimeout(temporizadorDoSelo);
      temporizadorDoSelo = setTimeout(() => setSelo(false), DURACAO_DO_SELO_MS);
    });
    const aoIniciar = doLote<EventosDoServidor['lote_iniciado']>(() => atualizar(aplicarIniciado));
    const aoEncerrar = doLote((e: EventosDoServidor['lote_encerrado']) =>
      atualizar((s) => aplicarEncerrado(s, e)),
    );
    const aoCancelar = doLote<EventosDoServidor['lote_cancelado']>(() =>
      atualizar(aplicarCancelado),
    );
    const aoSerSuperado = doLote((e: EventosDoServidor['voce_foi_superado']) =>
      atualizar((s) => aplicarSuperado(s, e)),
    );
    const aoConectar = () => {
      limparPrazo();
      entrar();
    };
    const aoPerder = () => {
      setReconectando(true);
      iniciarPrazo();
    };

    socket.on('connect', aoConectar);
    socket.on('disconnect', aoPerder);
    socket.on('connect_error', aoPerder);
    socket.on('lance_aceito', aoLance);
    socket.on('fim_estendido', aoFimEstendido);
    socket.on('lote_iniciado', aoIniciar);
    socket.on('lote_encerrado', aoEncerrar);
    socket.on('lote_cancelado', aoCancelar);
    socket.on('voce_foi_superado', aoSerSuperado);
    // Já conectado ao montar: o evento `connect` não virá de novo.
    if (socket.connected) entrar();
    else iniciarPrazo();

    return () => {
      ativo = false;
      clearTimeout(temporizadorDoResync);
      clearTimeout(temporizadorDoSelo);
      clearTimeout(temporizadorDoPrazo);
      setSelo(false);
      socket.off('connect', aoConectar);
      socket.off('disconnect', aoPerder);
      socket.off('connect_error', aoPerder);
      socket.off('lance_aceito', aoLance);
      socket.off('fim_estendido', aoFimEstendido);
      socket.off('lote_iniciado', aoIniciar);
      socket.off('lote_encerrado', aoEncerrar);
      socket.off('lote_cancelado', aoCancelar);
      socket.off('voce_foi_superado', aoSerSuperado);
      if (socket.connected) socket.emit('sair_lote', { loteId });
    };
  }, [socket, loteId, tentativa]);

  const tentarDeNovo = () => {
    setErro(null);
    setTentativa((n) => n + 1);
  };

  return { estado, erro, reconectando, seloDeFimEstendido, tentarDeNovo };
}
