import { focusManager } from '@tanstack/react-query';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PRAZO_SEM_ESTADO_MS, TIMEOUT_DA_ENTRADA_MS } from '../../src/sala/useSalaAoVivo';
import { criarLoteDetalhe, servirDetalhe } from '../apoio/fixtures-lotes';
import { simularPreferenciaDoSistema } from '../apoio/matchMedia';
import { renderizarComTempoReal } from '../apoio/renderizarComTempoReal';
import {
  abrir,
  criarEstado,
  entradas,
  expirar,
  ID,
  lanceAceito,
  responder,
  TITULO,
} from '../apoio/salaApoio';
import { envelopeDeErro, ORIGEM, servidor } from '../apoio/servidor';
import { SocketFalso } from '../apoio/socketFalso';

const TEXTO_INDISPONIVEL = 'O serviço está indisponível agora. Tente de novo em instantes.';
const TEXTO_SALA_CHEIA = 'Esta sala está cheia agora. Tente de novo em instantes.';
const OUTRO_ID = '0192f3a0-0000-7000-8000-000000000202';
const PRECO_DO_LOTE_A = /^Lance atual: R\$\s1\.234,56$/;

afterEach(() => {
  vi.useRealTimers();
  focusManager.setFocused(undefined);
});

describe('sala: ack de entrar_lote', () => {
  it('emite com timeout nomeado', async () => {
    const { socket } = await abrir(null);

    expect(entradas(socket)[0]?.timeoutMs).toBe(TIMEOUT_DA_ENTRADA_MS);
  });

  it('timeout sem estado: erro com "Tentar de novo", que refaz a entrada', async () => {
    const user = userEvent.setup();
    const { socket } = await abrir(null);

    expirar(socket);

    expect(await screen.findByRole('alert')).toHaveTextContent(TEXTO_INDISPONIVEL);
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    await waitFor(() => expect(entradas(socket)).toHaveLength(2));
    responder(socket, { sucesso: true, estado: criarEstado() });
    expect(await screen.findByRole('heading', { level: 1, name: TITULO })).toBeInTheDocument();
  });

  it('timeout com estado: a sala continua e mostra "Reconectando…"', async () => {
    const { socket } = await abrir();

    act(() => socket.receber('connect'));
    expirar(socket);

    expect(await screen.findByText('Reconectando…')).toHaveAttribute('role', 'status');
    expect(screen.getByRole('heading', { level: 1, name: TITULO })).toBeInTheDocument();
    expect(screen.getByText(PRECO_DO_LOTE_A)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tentar de novo' })).not.toBeInTheDocument();
  });

  it.each([
    ['null', null],
    ['string', 'ok'],
    ['sem sucesso', {}],
    ['sucesso não booleano', { sucesso: 'sim' }],
    ['sucesso sem estado', { sucesso: true }],
    ['estado sem lote', { sucesso: true, estado: { ultimosLances: [], agoraServidor: 'x' } }],
    ['falha sem erro', { sucesso: false }],
    ['falha com código desconhecido', { sucesso: false, erro: { codigo: 'XYZ', mensagem: 'x' } }],
  ])('ack inválido (%s) vira erro de entrada, sem quebrar', async (_nome, ack) => {
    const { socket } = await abrir(null);

    responder(socket, ack);

    expect(await screen.findByRole('alert')).toHaveTextContent(TEXTO_INDISPONIVEL);
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument();
  });
});

describe('sala: erro depois que a sala já abriu', () => {
  it('ack de resync com erro mantém a sala e avisa com role="status"', async () => {
    const { socket } = await abrir();

    act(() => socket.receber('connect'));
    responder(socket, { sucesso: false, erro: { codigo: 'SALA_CHEIA', mensagem: 'x' } });

    expect(await screen.findByText('Reconectando…')).toHaveAttribute('role', 'status');
    expect(screen.getByText(PRECO_DO_LOTE_A)).toBeInTheDocument();
    // A sala sempre tem o `role="alert"` (assertive) vazio; o que não pode existir é o texto de erro.
    expect(screen.queryByText(TEXTO_SALA_CHEIA)).not.toBeInTheDocument();
  });

  it('erro no refetch do detalhe mantém a sala e avisa com role="status"', async () => {
    await abrir();
    servidor.use(http.get(`${ORIGEM}/api/lotes/${ID}`, () => envelopeDeErro('INDISPONIVEL', 503)));

    // Volta o foco à janela: com `staleTime` 0 o detalhe é buscado de novo, e agora falha.
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });

    expect(await screen.findByText('Reconectando…')).toHaveAttribute('role', 'status');
    expect(screen.getByRole('heading', { level: 1, name: TITULO })).toBeInTheDocument();
    expect(screen.queryByText(TEXTO_INDISPONIVEL)).not.toBeInTheDocument();
  });

  it('o aviso some quando o novo entrar_lote responde com sucesso', async () => {
    const { socket } = await abrir();

    act(() => socket.receber('connect'));
    expirar(socket);
    await screen.findByText('Reconectando…');
    act(() => socket.receber('connect'));
    responder(socket, { sucesso: true, estado: criarEstado() });

    await waitFor(() => expect(screen.queryByText('Reconectando…')).not.toBeInTheDocument());
  });
});

describe('sala: troca de lote', () => {
  it('ao ir de /lotes/a para /lotes/b nada de a aparece sob a carta de b', async () => {
    const { socket, router } = await abrir();
    act(() => socket.receber('fim_estendido', { loteId: ID, fimEm: '2026-10-25T14:07:03Z' }));
    expect(screen.getByText(/Fim estendido$/)).toBeInTheDocument();
    servidor.use(servirDetalhe(criarLoteDetalhe({ id: OUTRO_ID, titulo: 'Outra carta' })));

    await act(async () => {
      await router.navigate(`/lotes/${OUTRO_ID}`);
    });

    expect(screen.queryByText(PRECO_DO_LOTE_A)).not.toBeInTheDocument();
    expect(screen.queryByText(/Fim estendido$/)).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Carregando sala…');
    expect(socket.emitidos.filter((e) => e.evento === 'sair_lote')[0]?.args[0]).toEqual({
      loteId: ID,
    });
    // O StrictMode dos testes monta o efeito duas vezes; só a última entrada tem ack válido.
    await waitFor(() => expect(entradas(socket).length).toBeGreaterThan(1));
    expect(entradas(socket).at(-1)?.args[0]).toEqual({ loteId: OUTRO_ID });

    responder(socket, {
      sucesso: true,
      estado: criarEstado({ id: OUTRO_ID, lanceAtualCentavos: 77_700, totalLances: 1 }),
    });

    expect(await screen.findByText(/^Lance atual: R\$\s777,00$/)).toBeInTheDocument();
    expect(screen.queryByText(PRECO_DO_LOTE_A)).not.toBeInTheDocument();
    expect(screen.queryByText(/Fim estendido$/)).not.toBeInTheDocument();
  });

  it('o ack atrasado do lote anterior não alimenta a sala do novo', async () => {
    const { socket, router } = await abrir(null);
    servidor.use(servirDetalhe(criarLoteDetalhe({ id: OUTRO_ID, titulo: 'Outra carta' })));

    await act(async () => {
      await router.navigate(`/lotes/${OUTRO_ID}`);
    });
    await waitFor(() => expect(entradas(socket).length).toBeGreaterThan(1));
    responder(socket, { sucesso: true, estado: criarEstado() }, 0);

    expect(screen.queryByText(PRECO_DO_LOTE_A)).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Carregando sala…');
  });
});

describe('sala: falha da conexão inicial', () => {
  function abrirSemConexao() {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    servidor.use(servirDetalhe(criarLoteDetalhe({ id: ID })));
    simularPreferenciaDoSistema(false);
    const socket = new SocketFalso();
    renderizarComTempoReal(`/lotes/${ID}`, socket);
    return socket;
  }

  it('connect_error sem estado mostra "Reconectando…" e, passado o prazo, o erro de rede', () => {
    const socket = abrirSemConexao();
    expect(screen.getByRole('status')).toHaveTextContent('Carregando sala…');

    act(() => socket.receber('connect_error'));
    expect(screen.getByRole('status')).toHaveTextContent('Reconectando…');
    act(() => vi.advanceTimersByTime(PRAZO_SEM_ESTADO_MS - 1));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole('alert')).toHaveTextContent(TEXTO_INDISPONIVEL);
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument();
  });

  it('conectar dentro do prazo cancela o erro', () => {
    const socket = abrirSemConexao();

    act(() => socket.receber('disconnect'));
    act(() => socket.receber('connect'));
    act(() => vi.advanceTimersByTime(PRAZO_SEM_ESTADO_MS * 2));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(entradas(socket)).toHaveLength(1);
  });
});

describe('sala: eventos atrasados depois do fim', () => {
  it('lance, superado e lote_iniciado atrasados não desfazem "Você venceu"', async () => {
    const { socket } = await abrir(
      criarEstado({}, { seuPseudonimo: 'Gato-1', suaPosicao: 'ganhando' }),
    );
    act(() =>
      socket.receber('lote_encerrado', {
        loteId: ID,
        vencedorPseudonimo: 'Gato-1',
        valorArremateCentavos: 123_456,
      }),
    );
    await screen.findByText('Você venceu este lote.');

    act(() => socket.receber('lance_aceito', lanceAceito()));
    act(() => socket.receber('voce_foi_superado', { loteId: ID, valorCentavos: 130_000 }));
    act(() => socket.receber('lote_iniciado', { loteId: ID }));
    act(() => socket.receber('lote_cancelado', { loteId: ID }));

    expect(screen.getByText('Você venceu este lote.')).toBeInTheDocument();
    expect(screen.getByText('Este lote foi encerrado.')).toBeInTheDocument();
    expect(screen.queryByText('Este lote foi cancelado.')).not.toBeInTheDocument();
    expect(screen.getByText('3 lances')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeEmptyDOMElement();
  });

  it('fim_estendido atrasado com fim menor não encurta a contagem nem mostra o selo', async () => {
    const { socket } = await abrir();

    act(() => socket.receber('fim_estendido', { loteId: ID, fimEm: '2026-10-25T13:30:00Z' }));

    expect(screen.queryByText(/Fim estendido$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/foi estendido para/)).not.toBeInTheDocument();
  });
});

describe('sala: acks fora de ordem', () => {
  it('o ack antigo não sobrescreve o estado do ack novo', async () => {
    const { socket } = await abrir(null);

    act(() => socket.receber('connect'));
    expect(entradas(socket)).toHaveLength(2);
    responder(
      socket,
      { sucesso: true, estado: criarEstado({ lanceAtualCentavos: 200_000, totalLances: 9 }) },
      1,
    );
    expect(await screen.findByText(/^Lance atual: R\$\s2\.000,00$/)).toBeInTheDocument();

    responder(socket, { sucesso: true, estado: criarEstado() }, 0);

    expect(screen.getByText(/^Lance atual: R\$\s2\.000,00$/)).toBeInTheDocument();
    expect(screen.getByText('9 lances')).toBeInTheDocument();
  });

  it('o timeout do ack antigo não derruba a sala que o ack novo abriu', async () => {
    const { socket } = await abrir(null);

    act(() => socket.receber('connect'));
    responder(socket, { sucesso: true, estado: criarEstado() }, 1);
    await screen.findByRole('heading', { level: 1, name: TITULO });
    expirar(socket, 0);

    expect(screen.queryByText('Reconectando…')).not.toBeInTheDocument();
    expect(screen.queryByText(TEXTO_INDISPONIVEL)).not.toBeInTheDocument();
  });
});
