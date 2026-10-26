import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { focusManager } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { violacoesSerias } from '../apoio/axe';
import { criarLote, servirMeusLotes, servirResumo } from '../apoio/fixtures-lotes';
import { simularPreferenciaDoSistema } from '../apoio/matchMedia';
import { renderizarApp } from '../apoio/renderizarApp';
import { envelopeDeErro, ORIGEM, servidor, usuarioLeiloeiro } from '../apoio/servidor';

const ID = '0198f3c0-7b1a-7c00-8000-000000000001';
const TEXTO_DO_AVISO =
  'O lote "Black Lotus" será cancelado e não poderá ser reaberto. Se houver um líder, o valor reservado para o lance dele será estornado.';

function servirCancelamento(resposta: () => Response | Promise<Response>) {
  const chamadas: string[] = [];
  const handler = http.post(`${ORIGEM}/api/painel/lotes/${ID}/cancelamento`, async () => {
    chamadas.push(ID);
    return resposta();
  });
  return { handler, chamadas };
}

const cancelado = () =>
  HttpResponse.json({ sucesso: true, dados: criarLote({ id: ID, status: 'cancelado' }) });

function abrir(escuro = false, status: 'ao_vivo' | 'agendado' = 'ao_vivo') {
  simularPreferenciaDoSistema(escuro);
  servidor.use(
    servirResumo(),
    servirMeusLotes([criarLote({ id: ID, titulo: 'Black Lotus', status })]).handler,
  );
  return renderizarApp('/painel', { sessao: usuarioLeiloeiro });
}

async function abrirDialogo(user: ReturnType<typeof userEvent.setup>) {
  const botao = await screen.findByRole('button', { name: 'Cancelar lote Black Lotus' });
  await user.click(botao);
  return { botao, dialogo: await screen.findByRole('dialog') };
}

describe('painel: ações da tabela', () => {
  it('"Cancelar lote" só em agendado e ao_vivo; "Auditoria" só em encerrado e cancelado', async () => {
    simularPreferenciaDoSistema(false);
    servidor.use(
      servirResumo(),
      servirMeusLotes([
        criarLote({ id: 'a', titulo: 'A', status: 'agendado' }),
        criarLote({ id: 'b', titulo: 'B', status: 'ao_vivo' }),
        criarLote({ id: 'c', titulo: 'C', status: 'encerrado' }),
        criarLote({ id: 'd', titulo: 'D', status: 'cancelado' }),
      ]).handler,
    );
    renderizarApp('/painel', { sessao: usuarioLeiloeiro });
    const tabela = await screen.findByRole('table', { name: 'Meus lotes' });
    const linhaDe = (titulo: string) => {
      const linha = within(tabela).getByRole('link', { name: titulo }).closest('tr');
      if (!linha) throw new Error(`sem linha para ${titulo}`);
      return within(linha);
    };
    for (const titulo of ['A', 'B']) {
      const linha = linhaDe(titulo);
      expect(linha.getByRole('button', { name: /^Cancelar lote / })).toBeInTheDocument();
      expect(linha.queryByRole('link', { name: /^Auditoria/ })).not.toBeInTheDocument();
    }
    for (const [id, titulo] of [
      ['c', 'C'],
      ['d', 'D'],
    ] as const) {
      const linha = linhaDe(titulo);
      expect(linha.getByRole('link', { name: `Auditoria do lote ${titulo}` })).toHaveAttribute(
        'href',
        `/auditoria/${id}`,
      );
      expect(linha.queryByRole('button')).not.toBeInTheDocument();
    }
  });
});

describe('painel: cancelar lote', () => {
  it('abre o diálogo com título, texto e foco em "Manter lote"', async () => {
    abrir();
    const user = userEvent.setup();
    const { dialogo } = await abrirDialogo(user);

    expect(dialogo).toHaveAttribute('aria-modal', 'true');
    expect(dialogo).toHaveAccessibleName('Cancelar este lote?');
    expect(within(dialogo).getByText(TEXTO_DO_AVISO)).toBeInTheDocument();
    expect(within(dialogo).getByRole('button', { name: 'Confirmar cancelamento' })).toBeEnabled();
    expect(within(dialogo).getByRole('button', { name: 'Manter lote' })).toHaveFocus();
  });

  it('"Manter lote" e Esc fecham sem chamar a API e devolvem o foco ao botão', async () => {
    const { handler, chamadas } = servirCancelamento(cancelado);
    servidor.use(handler);
    abrir();
    const user = userEvent.setup();

    let { botao } = await abrirDialogo(user);
    await user.click(screen.getByRole('button', { name: 'Manter lote' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(botao).toHaveFocus();

    ({ botao } = await abrirDialogo(user));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(botao).toHaveFocus();
    expect(chamadas).toHaveLength(0);
  });

  it('prende o foco no diálogo com Tab e Shift+Tab', async () => {
    abrir();
    const user = userEvent.setup();
    const { dialogo } = await abrirDialogo(user);
    const confirmar = within(dialogo).getByRole('button', { name: 'Confirmar cancelamento' });
    const manter = within(dialogo).getByRole('button', { name: 'Manter lote' });

    await user.tab();
    expect(confirmar).toHaveFocus();
    await user.tab({ shift: true });
    expect(manter).toHaveFocus();
    await user.tab({ shift: true });
    expect(confirmar).toHaveFocus();
    await user.tab({ shift: true });
    expect(manter).toHaveFocus();
  });

  it('confirmar chama a rota uma vez (mesmo com dois cliques no mesmo tick), mostra "Cancelando…" e o aviso', async () => {
    let liberar: () => void = () => undefined;
    const portao = new Promise<void>((resolve) => {
      liberar = resolve;
    });
    const { handler, chamadas } = servirCancelamento(async () => {
      await portao;
      return cancelado();
    });
    servidor.use(handler);
    abrir();
    const user = userEvent.setup();
    const { dialogo } = await abrirDialogo(user);
    const confirmar = within(dialogo).getByRole('button', { name: 'Confirmar cancelamento' });

    act(() => {
      confirmar.click();
      confirmar.click();
    });
    expect(await within(dialogo).findByRole('button', { name: 'Cancelando…' })).toBeDisabled();
    expect(within(dialogo).getByRole('button', { name: 'Manter lote' })).toBeDisabled();

    servidor.use(
      servirMeusLotes([criarLote({ id: ID, titulo: 'Black Lotus', status: 'cancelado' })]).handler,
    );
    liberar();
    const aviso = await screen.findByRole('status');
    expect(aviso).toHaveTextContent(
      'Lote cancelado. Se havia líder, o valor reservado foi estornado.',
    );
    await waitFor(() => expect(aviso).toHaveFocus());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(chamadas).toHaveLength(1);
    // A lista foi refeita: o lote agora tem link de auditoria.
    expect(
      await screen.findByRole('link', { name: 'Auditoria do lote Black Lotus' }),
    ).toBeVisible();
  });

  it('409 LOTE_ENCERRADO fecha o diálogo e mostra o alerta', async () => {
    servidor.use(servirCancelamento(() => envelopeDeErro('LOTE_ENCERRADO', 409)).handler);
    abrir();
    const user = userEvent.setup();
    await abrirDialogo(user);
    await user.click(screen.getByRole('button', { name: 'Confirmar cancelamento' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível cancelar: o lote já foi encerrado ou cancelado.',
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('404 fecha o diálogo e mostra o alerta', async () => {
    servidor.use(servirCancelamento(() => envelopeDeErro('NAO_ENCONTRADO', 404)).handler);
    abrir();
    const user = userEvent.setup();
    await abrirDialogo(user);
    await user.click(screen.getByRole('button', { name: 'Confirmar cancelamento' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não encontramos este lote. A lista foi atualizada.',
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('erro geral mantém o diálogo aberto com os botões habilitados', async () => {
    servidor.use(servirCancelamento(() => envelopeDeErro('INDISPONIVEL', 503)).handler);
    abrir();
    const user = userEvent.setup();
    const { dialogo } = await abrirDialogo(user);
    await user.click(within(dialogo).getByRole('button', { name: 'Confirmar cancelamento' }));

    expect(await within(dialogo).findByRole('alert')).toHaveTextContent(
      'O serviço está indisponível agora. Tente de novo em instantes.',
    );
    expect(within(dialogo).getByRole('button', { name: 'Confirmar cancelamento' })).toBeEnabled();
    expect(within(dialogo).getByRole('button', { name: 'Manter lote' })).toBeEnabled();
  });

  it('refaz o resumo quando a janela recupera o foco', async () => {
    let consultas = 0;
    simularPreferenciaDoSistema(false);
    servidor.use(
      http.get(`${ORIGEM}/api/painel/resumo`, () => {
        consultas += 1;
        return HttpResponse.json({
          sucesso: true,
          dados: { totalRecebidoCentavos: consultas * 1000, lotesArrematados: 0, lotesSemLance: 0 },
        });
      }),
      servirMeusLotes([]).handler,
    );
    renderizarApp('/painel', { sessao: usuarioLeiloeiro });
    await screen.findByText(/^R\$\s10,00$/);

    act(() => focusManager.setFocused(false));
    act(() => focusManager.setFocused(true));
    expect(await screen.findByText(/^R\$\s20,00$/)).toBeInTheDocument();
  });

  it.each([false, true])(
    'axe sem violações sérias com o diálogo aberto (escuro: %s)',
    async (escuro) => {
      abrir(escuro);
      const user = userEvent.setup();
      await abrirDialogo(user);
      expect(await violacoesSerias(document.body)).toEqual([]);
    },
  );
});
