import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { violacoesSerias } from '../apoio/axe';
import { simularPreferenciaDoSistema } from '../apoio/matchMedia';
import { renderizarComTempoReal } from '../apoio/renderizarComTempoReal';
import {
  abrir,
  criarEstado,
  entradas,
  FIM,
  ID,
  lanceAceito,
  RELOGIO_LOCAL,
  responder,
} from '../apoio/salaApoio';
import { envelopeDeErro, ORIGEM, servidor } from '../apoio/servidor';
import { SocketFalso } from '../apoio/socketFalso';

/** Itens do histórico "Últimos lances" (a carta também tem uma lista). */
function itensDoHistorico(): HTMLElement[] {
  return within(screen.getByRole('region', { name: 'Últimos lances' })).queryAllByRole('listitem');
}

afterEach(() => {
  vi.useRealTimers();
});

describe('sala ao vivo: estado inicial', () => {
  it('entra no room do lote e mostra carta, dados, histórico e contagem pelo relógio do servidor', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(RELOGIO_LOCAL));
    const { socket } = await abrir();

    expect(entradas(socket)[0]?.args[0]).toEqual({ loteId: ID });
    expect(screen.getByRole('img', { name: 'Carta Black Lotus' })).toBeInTheDocument();
    expect(screen.getByText('Carta: Black Lotus')).toBeInTheDocument();
    expect(screen.getByText(/^Lance atual: R\$\s1\.234,56$/)).toBeInTheDocument();
    expect(screen.getByText('3 lances')).toBeInTheDocument();
    // Com o relógio local (sem correção) seriam 02:02:03.
    expect(screen.getByRole('timer')).toHaveTextContent('Termina em 01:02:03');
    expect(screen.getByRole('timer')).not.toHaveAttribute('aria-live');
    expect(screen.getByText(/^Fim: 25\/10\/2026,? 11:02$/)).toBeInTheDocument();
    await waitFor(() =>
      expect(document.title).toBe('Black Lotus em estado raro · Casa de Leilões'),
    );

    const itens = itensDoHistorico();
    expect(itens).toHaveLength(3);
    expect(itens[0]?.textContent).toMatch(/^Gato-1 · R\$\s1\.234,56 · \d{2}:\d{2}:\d{2}$/);
  });

  it('com dias restantes mostra "{d} d HH:MM:SS"', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(RELOGIO_LOCAL));
    await abrir(criarEstado({ fimEm: '2026-10-27T13:00:01Z' }));

    expect(screen.getByRole('timer')).toHaveTextContent('Termina em 2 d 00:00:01');
  });

  it('no zero mostra "Encerrando…" e nunca tempo negativo', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(RELOGIO_LOCAL));
    await abrir(criarEstado({ fimEm: '2026-10-25T12:59:00Z' }));

    expect(screen.getByRole('timer')).toHaveTextContent('Encerrando…');
  });

  it('sem lances: texto com o lance inicial', async () => {
    await abrir(criarEstado({ lanceAtualCentavos: null, totalLances: 0 }, { ultimosLances: [] }));

    expect(
      screen.getByText(
        /^Nenhum lance ainda\. O primeiro lance deve ser de pelo menos R\$\s100,00\.$/,
      ),
    ).toBeInTheDocument();
  });

  it('enquanto o estado não chega: status "Carregando sala…" e <title> "Lote"', async () => {
    await abrir(null);

    expect(screen.getByRole('status')).toHaveTextContent('Carregando sala…');
    await waitFor(() => expect(document.title).toBe('Lote · Casa de Leilões'));
  });
});

describe('sala ao vivo: eventos', () => {
  it('lance_aceito entra no topo, atualiza o lance atual e anuncia no aria-live polite', async () => {
    const { socket } = await abrir();

    act(() => socket.receber('lance_aceito', lanceAceito()));

    expect(await screen.findByText(/^Lance atual: R\$\s1\.300,00$/)).toBeInTheDocument();
    expect(screen.getByText('4 lances')).toBeInTheDocument();
    const itens = itensDoHistorico();
    expect(itens[0]?.textContent).toMatch(/^Raposa-7 · R\$\s1\.300,00 ·/);
    const polite = document.querySelector('[aria-live="polite"]');
    expect(polite).toHaveTextContent(/^Novo lance de R\$\s1\.300,00 por Raposa-7\.$/);
  });

  it('o histórico guarda só 50 lances: o 51º sai', async () => {
    const lances = Array.from({ length: 50 }, (_, i) => ({
      seq: 50 - i,
      pseudonimo: `Urso-${50 - i}`,
      valorCentavos: 10_000 + (50 - i) * 500,
      criadoEm: '2026-10-25T11:00:00Z',
    }));
    const { socket } = await abrir(criarEstado({ totalLances: 50 }, { ultimosLances: lances }));

    act(() => socket.receber('lance_aceito', lanceAceito({ seq: 51, totalLances: 51 })));

    await screen.findByText('51 lances');
    const itens = itensDoHistorico();
    expect(itens).toHaveLength(50);
    expect(itens[0]?.textContent).toContain('Raposa-7');
    expect(itens.at(-1)?.textContent).toContain('Urso-2 ');
  });

  it('ignora lance atrasado e evento de outro lote', async () => {
    const { socket } = await abrir();

    act(() => socket.receber('lance_aceito', lanceAceito({ seq: 3, totalLances: 3 })));
    act(() => socket.receber('lance_aceito', lanceAceito({ loteId: 'outro-lote' })));

    expect(screen.getByText('3 lances')).toBeInTheDocument();
    expect(itensDoHistorico()).toHaveLength(3);
  });

  it('fim_estendido: selo com ícone e texto por 10 s, aviso role="status" e novo fim', async () => {
    const { socket } = await abrir();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    act(() => socket.receber('fim_estendido', { loteId: ID, fimEm: '2026-10-25T14:07:03Z' }));

    const selo = screen.getByText(/Fim estendido$/);
    expect(selo.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(
      screen.getByText(/^O fim do lote foi estendido para 25\/10\/2026,? 11:07\.$/),
    ).toHaveAttribute('role', 'status');
    expect(screen.getByText(/^Fim: 25\/10\/2026,? 11:07$/)).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.queryByText(/Fim estendido$/)).not.toBeInTheDocument();
  });

  it('lote_encerrado mostra o aviso e o valor de arremate, sem posição se não participava', async () => {
    const { socket } = await abrir();

    act(() =>
      socket.receber('lote_encerrado', {
        loteId: ID,
        vencedorPseudonimo: 'Gato-1',
        valorArremateCentavos: 123_456,
      }),
    );

    expect(await screen.findByText('Este lote foi encerrado.')).toBeInTheDocument();
    expect(screen.getByText(/^Arrematado por R\$\s1\.234,56\.$/)).toBeInTheDocument();
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
    expect(screen.queryByText(/Você (venceu|não venceu)/)).not.toBeInTheDocument();
  });

  it('lote_cancelado mostra o aviso com role="status"', async () => {
    const { socket } = await abrir();

    act(() => socket.receber('lote_cancelado', { loteId: ID }));

    expect(await screen.findByText('Este lote foi cancelado.')).toHaveAttribute('role', 'status');
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
  });
});

describe('sala ao vivo: estados do lote', () => {
  it('encerrado com vencedor: arrematado e "Você venceu este lote."', async () => {
    await abrir(
      criarEstado(
        { status: 'encerrado', valorArremateCentavos: 123_456 },
        { seuPseudonimo: 'Gato-1', suaPosicao: 'venceu' },
      ),
    );

    expect(screen.getByText('Este lote foi encerrado.').closest('[role="status"]')).not.toBeNull();
    expect(screen.getByText(/^Arrematado por R\$\s1\.234,56\.$/)).toBeInTheDocument();
    expect(screen.getByText('Você venceu este lote.')).toBeInTheDocument();
  });

  it('encerrado: "Você não venceu este lote." para quem perdeu', async () => {
    await abrir(
      criarEstado(
        { status: 'encerrado', valorArremateCentavos: 123_456 },
        { seuPseudonimo: 'Lobo-2', suaPosicao: 'perdeu' },
      ),
    );

    expect(screen.getByText('Você não venceu este lote.')).toBeInTheDocument();
  });

  it('cancelado vindo do estado inicial', async () => {
    await abrir(criarEstado({ status: 'cancelado' }));

    expect(screen.getByText('Este lote foi cancelado.')).toHaveAttribute('role', 'status');
  });

  it('agendado: "Este lote ainda não começou. Abre em {início}."', async () => {
    await abrir(criarEstado({ status: 'agendado', inicioEm: '2026-10-26T13:00:00Z' }));

    expect(
      screen.getByText(/^Este lote ainda não começou\. Abre em 26\/10\/2026,? 10:00\.$/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
  });
});

describe('sala ao vivo: posição do usuário', () => {
  const comPseudonimo = { seuPseudonimo: 'Gato-1' } as const;

  it('ganhando: ícone e texto', async () => {
    await abrir(criarEstado({}, { ...comPseudonimo, suaPosicao: 'ganhando' }));

    const texto = screen.getByText(/Você está ganhando este lote\./);
    expect(texto.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(itensDoHistorico()[0]?.textContent).toMatch(/^Gato-1 \(você\) ·/);
    expect(itensDoHistorico()[1]?.textContent).not.toContain('(você)');
  });

  it('superado: ícone, texto com o lance atual e alerta assertive', async () => {
    await abrir(criarEstado({}, { ...comPseudonimo, suaPosicao: 'superado' }));

    const texto = screen.getByText(/Você foi superado\. O lance atual é R\$\s1\.234,56\./);
    expect(texto.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it('sem_lance, anônimo e leiloeiro: sem indicador', async () => {
    await abrir(criarEstado({}, { ...comPseudonimo, suaPosicao: 'sem_lance' }));

    expect(screen.queryByText(/Você (está ganhando|foi superado)/)).not.toBeInTheDocument();
  });

  it('voce_foi_superado muda a posição e anuncia no alerta assertive', async () => {
    const { socket } = await abrir(criarEstado({}, { ...comPseudonimo, suaPosicao: 'ganhando' }));

    act(() => socket.receber('voce_foi_superado', { loteId: ID, valorCentavos: 130_000 }));

    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent(/^Você foi superado\. O lance atual é R\$\s1\.300,00\.$/);
    expect(alerta).toHaveAttribute('aria-live', 'assertive');
    expect(screen.queryByText(/Você está ganhando/)).not.toBeInTheDocument();
  });

  it('lance de outro pseudônimo com o usuário ganhando também supera', async () => {
    const { socket } = await abrir(criarEstado({}, { ...comPseudonimo, suaPosicao: 'ganhando' }));

    act(() => socket.receber('lance_aceito', lanceAceito()));

    expect(await screen.findByRole('alert')).toHaveTextContent(/^Você foi superado\./);
    expect(screen.queryByText(/Você está ganhando/)).not.toBeInTheDocument();
  });

  it('lance do próprio pseudônimo vira "ganhando" e não anuncia como novo lance nem superado', async () => {
    const { socket } = await abrir(criarEstado({}, { ...comPseudonimo, suaPosicao: 'superado' }));

    act(() =>
      socket.receber('lance_aceito', lanceAceito({ pseudonimo: 'Gato-1', valorCentavos: 140_000 })),
    );

    expect(await screen.findByText(/Você está ganhando este lote\./)).toBeInTheDocument();
    expect(document.querySelector('[aria-live="polite"]')).toBeEmptyDOMElement();
  });

  it('lote_encerrado converte a posição em venceu ou perdeu', async () => {
    const { socket } = await abrir(criarEstado({}, { ...comPseudonimo, suaPosicao: 'ganhando' }));

    act(() =>
      socket.receber('lote_encerrado', {
        loteId: ID,
        vencedorPseudonimo: 'Gato-1',
        valorArremateCentavos: 123_456,
      }),
    );

    expect(await screen.findByText('Você venceu este lote.')).toBeInTheDocument();
  });
});

describe('sala ao vivo: resync e conexão', () => {
  it('a cada reconexão refaz entrar_lote e substitui o estado local', async () => {
    const { socket } = await abrir();

    act(() => socket.receber('disconnect'));
    expect(screen.getByRole('status')).toHaveTextContent('Reconectando…');
    act(() => socket.receber('connect'));
    expect(entradas(socket)).toHaveLength(2);
    responder(socket, {
      sucesso: true,
      estado: criarEstado({ lanceAtualCentavos: 200_000, totalLances: 9 }),
    });

    expect(await screen.findByText(/^Lance atual: R\$\s2\.000,00$/)).toBeInTheDocument();
    expect(screen.getByText('9 lances')).toBeInTheDocument();
    expect(screen.queryByText('Reconectando…')).not.toBeInTheDocument();
  });

  it('sem eventos por 30 s numa sala ao vivo faz resync preventivo; cada evento reinicia a espera', async () => {
    const { socket } = await abrir();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    act(() => socket.receber('lance_aceito', lanceAceito()));
    act(() => vi.advanceTimersByTime(29_000));
    expect(entradas(socket)).toHaveLength(1);
    act(() => socket.receber('fim_estendido', { loteId: ID, fimEm: FIM }));
    act(() => vi.advanceTimersByTime(29_000));
    expect(entradas(socket)).toHaveLength(1);

    act(() => vi.advanceTimersByTime(1_000));
    expect(entradas(socket)).toHaveLength(2);
  });

  it('sala encerrada não faz resync preventivo', async () => {
    const { socket } = await abrir(criarEstado({ status: 'encerrado' }));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    act(() => socket.receber('lote_cancelado', { loteId: ID }));
    act(() => vi.advanceTimersByTime(90_000));

    expect(entradas(socket)).toHaveLength(1);
  });

  it('ao desmontar sai do room e remove os ouvintes', async () => {
    const { socket, unmount } = await abrir();

    unmount();

    expect(socket.nomesEmitidos()).toContain('sair_lote');
    expect(socket.totalDeOuvintes()).toBe(0);
  });
});

describe('sala ao vivo: erros', () => {
  it('ack NAO_ENCONTRADO: "Lote não encontrado"', async () => {
    await abrir(null).then(({ socket }) =>
      responder(socket, { sucesso: false, erro: { codigo: 'NAO_ENCONTRADO', mensagem: 'x' } }),
    );

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Lote não encontrado' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voltar à vitrine' })).toHaveAttribute('href', '/');
  });

  it('detalhe 404: "Lote não encontrado"', async () => {
    servidor.use(
      http.get(`${ORIGEM}/api/lotes/${ID}`, () => envelopeDeErro('NAO_ENCONTRADO', 404)),
    );
    simularPreferenciaDoSistema(false);
    renderizarComTempoReal(`/lotes/${ID}`, new SocketFalso());

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Lote não encontrado' }),
    ).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe('Lote não encontrado · Casa de Leilões'));
  });

  it('SALA_CHEIA: mensagem e "Tentar de novo" que refaz entrar_lote', async () => {
    const user = userEvent.setup();
    const { socket } = await abrir(null);
    responder(socket, { sucesso: false, erro: { codigo: 'SALA_CHEIA', mensagem: 'x' } });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Esta sala está cheia agora. Tente de novo em instantes.',
    );
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }));

    await waitFor(() => expect(entradas(socket)).toHaveLength(2));
    responder(socket, { sucesso: true, estado: criarEstado() });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Black Lotus em estado raro' }),
    ).toBeInTheDocument();
  });

  it('INDISPONIVEL no ack: mensagem do código e "Tentar de novo"', async () => {
    const { socket } = await abrir(null);
    responder(socket, { sucesso: false, erro: { codigo: 'INDISPONIVEL', mensagem: 'x' } });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'O serviço está indisponível agora. Tente de novo em instantes.',
    );
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument();
  });
});

describe('sala ao vivo: acessibilidade', () => {
  it.each(['claro', 'escuro'])('axe sem violações sérias no tema %s', async (tema) => {
    if (tema === 'escuro') document.documentElement.dataset['theme'] = 'dark';
    await abrir(criarEstado({}, { seuPseudonimo: 'Gato-1', suaPosicao: 'superado' }));

    expect(await violacoesSerias()).toEqual([]);
  });
});
