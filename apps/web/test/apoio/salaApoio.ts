import { act, screen, waitFor } from '@testing-library/react';
import { expect } from 'vitest';

import type { EstadoDoServidor } from '../../src/sala/tiposDoServidor';
import { criarLoteDetalhe, servirDetalhe } from './fixtures-lotes';
import { simularPreferenciaDoSistema } from './matchMedia';
import { renderizarComTempoReal } from './renderizarComTempoReal';
import { servidor } from './servidor';
import { SocketFalso } from './socketFalso';

export const ID = '0192f3a0-0000-7000-8000-000000000101';
export const RELOGIO_LOCAL = '2026-10-25T12:00:00Z';
/** O servidor está uma hora à frente do relógio local do teste. */
export const AGORA_SERVIDOR = '2026-10-25T13:00:00Z';
export const FIM = '2026-10-25T14:02:03Z';
export const TITULO = 'Black Lotus em estado raro';

export type Estado = EstadoDoServidor;

export function criarEstado(
  lote: Partial<Estado['lote']> = {},
  resto: Partial<Omit<Estado, 'lote'>> = {},
): Estado {
  return {
    lote: {
      id: ID,
      status: 'ao_vivo',
      inicioEm: '2026-10-24T13:00:00Z',
      fimEm: FIM,
      fimOriginalEm: FIM,
      lanceInicialCentavos: 10_000,
      incrementoMinimoCentavos: 500,
      lanceAtualCentavos: 123_456,
      totalLances: 3,
      valorArremateCentavos: null,
      ...lote,
    },
    ultimosLances: [
      { seq: 3, pseudonimo: 'Gato-1', valorCentavos: 123_456, criadoEm: '2026-10-25T11:50:00Z' },
      { seq: 2, pseudonimo: 'Lobo-2', valorCentavos: 120_000, criadoEm: '2026-10-25T11:40:00Z' },
      { seq: 1, pseudonimo: 'Gato-1', valorCentavos: 110_000, criadoEm: '2026-10-25T11:30:00Z' },
    ],
    agoraServidor: AGORA_SERVIDOR,
    ...resto,
  };
}

export function lanceAceito(sobrescritas: Record<string, unknown> = {}) {
  return {
    loteId: ID,
    seq: 4,
    pseudonimo: 'Raposa-7',
    valorCentavos: 130_000,
    criadoEm: '2026-10-25T12:00:00Z',
    fimEm: FIM,
    totalLances: 4,
    ...sobrescritas,
  };
}

export function entradas(socket: SocketFalso) {
  return socket.emitidos.filter((e) => e.evento === 'entrar_lote');
}

type Ack = (erro: unknown, resposta?: unknown) => void;

function ackDaEntrada(socket: SocketFalso, indice: number): Ack {
  const entrada = entradas(socket).at(indice);
  if (!entrada) throw new Error('entrar_lote não foi emitido');
  return entrada.args[1] as Ack;
}

/** Entrega o ack de uma entrada (por padrão a última), como o servidor faria. */
export function responder(socket: SocketFalso, ack: unknown, indice = -1): void {
  const entregar = ackDaEntrada(socket, indice);
  act(() => entregar(null, ack));
}

/** Simula o estouro do `timeout` do socket.io numa entrada (por padrão a última). */
export function expirar(socket: SocketFalso, indice = -1): void {
  const entregar = ackDaEntrada(socket, indice);
  act(() => entregar(new Error('operation has timed out')));
}

/** Abre `/lotes/{id}`, conecta o socket e, com `estado`, responde a entrada e espera o título. */
export async function abrir(
  estado: Estado | null = criarEstado(),
  socket = new SocketFalso(),
  id = ID,
) {
  servidor.use(servirDetalhe(criarLoteDetalhe({ id })));
  simularPreferenciaDoSistema(false);
  const app = renderizarComTempoReal(`/lotes/${id}`, socket);
  act(() => socket.receber('connect'));
  await waitFor(() => expect(entradas(socket)).toHaveLength(1));
  if (estado) {
    responder(socket, { sucesso: true, estado });
    await screen.findByRole('heading', { level: 1, name: TITULO });
  }
  return { ...app, socket };
}
