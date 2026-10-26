import { act, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DURACAO_DO_SELO_MS } from '../../src/sala/useSalaAoVivo';
import {
  abrir,
  criarEstado,
  entradas,
  ID,
  lanceAceito,
  RELOGIO_LOCAL,
  responder,
} from '../apoio/salaApoio';
import type { SocketFalso } from '../apoio/socketFalso';

const AVISO = /^O fim do lote foi estendido para /;
const FIM_ESTENDIDO = '2026-10-25T14:07:03Z';
/** Pelo relógio do servidor (1 h à frente do local), faltam 10 s. */
const FIM_EM_10S = '2026-10-25T13:00:10Z';

afterEach(() => {
  vi.useRealTimers();
});

function usarRelogioSimulado(): void {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(new Date(RELOGIO_LOCAL));
}

function avisos(): HTMLElement[] {
  return screen.queryAllByRole('status').filter((el) => AVISO.test(el.textContent ?? ''));
}

/** Reconecta e entrega o estado do resync, como o servidor faria. */
function ressincronizar(socket: SocketFalso, estado: unknown): void {
  act(() => socket.receber('connect'));
  responder(socket, { sucesso: true, estado });
}

describe('sala: encerramento visível', () => {
  it('depois de fimEm refaz o estado em até 2 s e mostra "Este lote foi encerrado."', async () => {
    const { socket } = await abrir();
    usarRelogioSimulado();
    ressincronizar(socket, criarEstado({ fimEm: FIM_EM_10S }));
    const antes = entradas(socket).length;

    act(() => vi.advanceTimersByTime(10_000));
    expect(entradas(socket)).toHaveLength(antes);

    act(() => vi.advanceTimersByTime(2_000));
    expect(entradas(socket)).toHaveLength(antes + 1);

    responder(socket, {
      sucesso: true,
      estado: criarEstado({ status: 'encerrado', fimEm: FIM_EM_10S }),
    });
    expect(screen.getByText('Este lote foi encerrado.')).toBeInTheDocument();
  });

  it('o prazo acompanha uma extensão do fim: não refaz a entrada no fim antigo', async () => {
    const { socket } = await abrir();
    usarRelogioSimulado();
    ressincronizar(socket, criarEstado({ fimEm: FIM_EM_10S }));
    const antes = entradas(socket).length;

    act(() => socket.receber('lance_aceito', lanceAceito({ fimEm: '2026-10-25T13:05:00Z' })));
    act(() => vi.advanceTimersByTime(20_000));

    expect(entradas(socket)).toHaveLength(antes);
  });

  it('se o servidor ainda não encerrou, tenta de novo sem martelar', async () => {
    const { socket } = await abrir();
    usarRelogioSimulado();
    ressincronizar(socket, criarEstado({ fimEm: FIM_EM_10S }));
    const antes = entradas(socket).length;
    act(() => vi.advanceTimersByTime(12_000));
    // O servidor responde 12 s depois: o fim já passou há 2 s e o status ainda é ao_vivo.
    responder(socket, {
      sucesso: true,
      estado: { ...criarEstado({ fimEm: FIM_EM_10S }), agoraServidor: '2026-10-25T13:00:12Z' },
    });

    act(() => vi.advanceTimersByTime(1_000));
    expect(entradas(socket)).toHaveLength(antes + 1);

    act(() => vi.advanceTimersByTime(5_000));
    expect(entradas(socket)).toHaveLength(antes + 2);
  });
});

describe('sala: lote agendado', () => {
  const AGENDADO = { status: 'agendado' as const, inicioEm: FIM_EM_10S };

  it('refaz a entrada perto de inicioEm e passa a ao vivo sem recarregar', async () => {
    const { socket } = await abrir(criarEstado(AGENDADO));
    usarRelogioSimulado();
    ressincronizar(socket, criarEstado(AGENDADO));
    const antes = entradas(socket).length;
    expect(screen.getByText(/^Este lote ainda não começou\./)).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(10_000));
    expect(entradas(socket)).toHaveLength(antes);
    act(() => vi.advanceTimersByTime(2_000));
    expect(entradas(socket)).toHaveLength(antes + 1);

    responder(socket, { sucesso: true, estado: criarEstado({ inicioEm: AGENDADO.inicioEm }) });
    expect(screen.queryByText(/^Este lote ainda não começou\./)).not.toBeInTheDocument();
    expect(screen.getByRole('timer')).toBeInTheDocument();
  });

  it('o resync de 30 s também vale para o lote agendado', async () => {
    const { socket } = await abrir(criarEstado({ status: 'agendado' }));
    usarRelogioSimulado();
    ressincronizar(socket, criarEstado({ status: 'agendado', inicioEm: '2026-10-26T13:00:00Z' }));
    const antes = entradas(socket).length;

    act(() => vi.advanceTimersByTime(30_000));

    expect(entradas(socket)).toHaveLength(antes + 1);
  });
});

describe('sala: fim estendido e resync', () => {
  it('fim_estendido atrasado não recua o fim; o selo some em 10 s e o aviso permanece', async () => {
    const { socket } = await abrir();
    usarRelogioSimulado();
    act(() => socket.receber('lance_aceito', lanceAceito({ fimEm: FIM_ESTENDIDO })));

    act(() => socket.receber('fim_estendido', { loteId: ID, fimEm: '2026-10-25T14:04:00Z' }));

    expect(screen.getByText(/^Fim: 25\/10\/2026,? 11:07$/)).toBeInTheDocument();
    expect(screen.getByText(/Fim estendido$/)).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(DURACAO_DO_SELO_MS - 100));
    expect(screen.getByText(/Fim estendido$/)).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(100));
    expect(screen.queryByText(/Fim estendido$/)).not.toBeInTheDocument();
    expect(avisos()).toHaveLength(1);
  });

  it('a entrada inicial não anuncia', async () => {
    await abrir(criarEstado({ fimEm: FIM_ESTENDIDO }));

    expect(avisos()).toHaveLength(0);
    expect(screen.queryByText(/Fim estendido$/)).not.toBeInTheDocument();
  });

  it('resync com fimEm igual preserva o aviso anterior', async () => {
    const { socket } = await abrir();
    act(() => socket.receber('fim_estendido', { loteId: ID, fimEm: FIM_ESTENDIDO }));
    const texto = avisos()[0]?.textContent;
    expect(texto).toBeTruthy();

    ressincronizar(socket, criarEstado({ fimEm: FIM_ESTENDIDO }));

    expect(avisos()).toHaveLength(1);
    expect(avisos()[0]?.textContent).toBe(texto);
  });

  it('resync com fimEm maior mostra o selo e anuncia uma única vez', async () => {
    const { socket } = await abrir();
    usarRelogioSimulado();

    ressincronizar(socket, criarEstado({ fimEm: FIM_ESTENDIDO }));

    expect(screen.getByText(/Fim estendido$/)).toBeInTheDocument();
    expect(avisos()).toHaveLength(1);
    expect(avisos()[0]).toHaveTextContent(/11:07\.$/);
    act(() => socket.receber('fim_estendido', { loteId: ID, fimEm: FIM_ESTENDIDO }));
    expect(avisos()).toHaveLength(1);
    act(() => vi.advanceTimersByTime(DURACAO_DO_SELO_MS));
    expect(screen.queryByText(/Fim estendido$/)).not.toBeInTheDocument();
    expect(avisos()).toHaveLength(1);
  });
});

describe('sala: lacuna de seq', () => {
  it('lance_aceito com salto de seq não é aplicado e força entrar_lote imediato', async () => {
    const { socket } = await abrir();
    expect(entradas(socket)).toHaveLength(1);

    act(() =>
      socket.receber(
        'lance_aceito',
        lanceAceito({ seq: 6, totalLances: 6, valorCentavos: 999_999 }),
      ),
    );

    expect(entradas(socket)).toHaveLength(2);
    expect(screen.getByText('3 lances')).toBeInTheDocument();
    expect(screen.queryByText(/9\.999,99/)).not.toBeInTheDocument();
  });

  it('lance_aceito repetido (seq já refletido) não refaz a entrada', async () => {
    const { socket } = await abrir();

    act(() => socket.receber('lance_aceito', lanceAceito({ seq: 3, totalLances: 3 })));

    expect(entradas(socket)).toHaveLength(1);
  });
});

describe('sala: encerrada e cancelada levam à auditoria', () => {
  it.each([
    ['encerrado', 'Este lote foi encerrado.'],
    ['cancelado', 'Este lote foi cancelado.'],
  ] as const)('lote %s tem o link "Ver auditoria"', async (status, texto) => {
    await abrir(criarEstado({ status }));

    expect(screen.getByText(texto)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver auditoria' })).toHaveAttribute(
      'href',
      `/auditoria/${ID}`,
    );
  });

  it('lote agendado não tem o link', async () => {
    await abrir(criarEstado({ status: 'agendado' }));

    expect(screen.queryByRole('link', { name: 'Ver auditoria' })).not.toBeInTheDocument();
  });
});
