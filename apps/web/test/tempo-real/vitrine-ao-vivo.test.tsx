import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { criarLote, servirLotes } from '../apoio/fixtures-lotes';
import { simularPreferenciaDoSistema } from '../apoio/matchMedia';
import { renderizarComTempoReal } from '../apoio/renderizarComTempoReal';
import { servidor } from '../apoio/servidor';
import { SocketFalso } from '../apoio/socketFalso';

const ID = '0192f3a0-0000-7000-8000-000000000101';

async function abrirVitrine(socket = new SocketFalso()) {
  const { handler, registro } = servirLotes([criarLote({ id: ID })]);
  servidor.use(handler);
  simularPreferenciaDoSistema(false);
  const app = renderizarComTempoReal('/', socket);
  await screen.findByText('1 lote encontrado');
  return { ...app, registro };
}

function lanceAceito(sobrescritas: Record<string, unknown> = {}) {
  return {
    loteId: ID,
    seq: 4,
    pseudonimo: 'Raposa-7',
    valorCentavos: 130_000,
    criadoEm: '2026-10-25T12:00:00Z',
    fimEm: '2026-10-26T15:35:00Z',
    totalLances: 4,
    ...sobrescritas,
  };
}

describe('vitrine ao vivo', () => {
  it('lance_aceito atualiza o card sem recarregar a página', async () => {
    const socket = new SocketFalso();
    const { registro } = await abrirVitrine(socket);
    act(() => socket.receber('connect'));
    await waitFor(() => expect(registro.consultas).toHaveLength(2));

    act(() => socket.receber('lance_aceito', lanceAceito()));

    const item = screen.getByRole('listitem');
    expect(await within(item).findByText(/^Lance atual: R\$\s1\.300,00$/)).toBeInTheDocument();
    expect(within(item).getByText('4 lances')).toBeInTheDocument();
    expect(within(item).getByText(/^Termina em 26\/10\/2026,? 12:35$/)).toBeInTheDocument();
    expect(registro.consultas).toHaveLength(2);
  });

  it('ignora lance_aceito atrasado (total menor que o do card)', async () => {
    const socket = new SocketFalso();
    await abrirVitrine(socket);

    act(() => socket.receber('lance_aceito', lanceAceito({ totalLances: 2, valorCentavos: 1 })));

    expect(screen.getByText('3 lances')).toBeInTheDocument();
  });

  it('fim_estendido atualiza só o fim do card', async () => {
    const socket = new SocketFalso();
    await abrirVitrine(socket);

    act(() => socket.receber('fim_estendido', { loteId: ID, fimEm: '2026-10-26T15:40:00Z' }));

    expect(await screen.findByText(/^Termina em 26\/10\/2026,? 12:40$/)).toBeInTheDocument();
    expect(screen.getByText('3 lances')).toBeInTheDocument();
  });

  it('evento de outro lote não altera o card', async () => {
    const socket = new SocketFalso();
    await abrirVitrine(socket);

    act(() => socket.receber('lance_aceito', lanceAceito({ loteId: 'outro' })));

    expect(screen.getByText('3 lances')).toBeInTheDocument();
  });

  it.each(['lote_iniciado', 'lote_encerrado', 'lote_cancelado'])(
    '%s refaz a consulta da lista',
    async (evento) => {
      const socket = new SocketFalso();
      const { registro } = await abrirVitrine(socket);
      expect(registro.consultas).toHaveLength(1);

      act(() => socket.receber(evento, { loteId: ID }));

      await waitFor(() => expect(registro.consultas).toHaveLength(2));
    },
  );

  it('entra no room ao conectar e refaz a consulta a cada reconexão (resync)', async () => {
    const socket = new SocketFalso();
    const { registro } = await abrirVitrine(socket);

    act(() => socket.receber('connect'));
    expect(socket.nomesEmitidos()).toContain('entrar_vitrine');
    await waitFor(() => expect(registro.consultas).toHaveLength(2));

    act(() => socket.receber('disconnect'));
    act(() => socket.receber('connect'));

    expect(socket.nomesEmitidos().filter((n) => n === 'entrar_vitrine')).toHaveLength(2);
    await waitFor(() => expect(registro.consultas).toHaveLength(3));
  });

  it('já conectado ao montar: entra no room na hora', async () => {
    const socket = new SocketFalso();
    socket.connected = true;
    await abrirVitrine(socket);

    expect(socket.nomesEmitidos()).toContain('entrar_vitrine');
  });

  it('desmontar sai do room e remove os listeners da vitrine', async () => {
    const socket = new SocketFalso();
    socket.connected = true;
    const { router } = await abrirVitrine(socket);
    const comVitrine = socket.totalDeOuvintes();
    expect(comVitrine).toBeGreaterThan(3);

    await act(() => router.navigate('/entrar'));

    await waitFor(() => expect(socket.nomesEmitidos().at(-1)).toBe('sair_vitrine'));
    // Sobram só os ouvintes do provedor (connect, disconnect, connect_error).
    expect(socket.totalDeOuvintes()).toBe(3);
  });

  it('a lista mantém aria-busy falso quando não está trocando de consulta', async () => {
    await abrirVitrine();

    expect(screen.getByRole('list')).toHaveAttribute('aria-busy', 'false');
  });

  it('fechar o app fecha o socket', async () => {
    const socket = new SocketFalso();
    const { unmount } = await abrirVitrine(socket);

    unmount();

    expect(socket.fechado).toBe(true);
    expect(socket.totalDeOuvintes()).toBe(0);
  });
});
