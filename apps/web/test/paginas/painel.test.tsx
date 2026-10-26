import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import { describe, expect, it } from 'vitest';

import { violacoesSerias } from '../apoio/axe';
import { criarLote, servirMeusLotes, servirResumo } from '../apoio/fixtures-lotes';
import { simularPreferenciaDoSistema } from '../apoio/matchMedia';
import { renderizarApp } from '../apoio/renderizarApp';
import {
  envelopeDeErro,
  ORIGEM,
  servidor,
  usuarioLeiloeiro,
  usuarioLicitante,
} from '../apoio/servidor';

function abrir(url = '/painel', escuro = false) {
  simularPreferenciaDoSistema(escuro);
  return renderizarApp(url, { sessao: usuarioLeiloeiro });
}

describe('/painel', () => {
  it('resumo zerado e lista vazia, com título, link e textos exatos', async () => {
    servidor.use(servirResumo(), servirMeusLotes([]).handler);
    abrir();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Painel do leiloeiro' }),
    ).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe('Painel do leiloeiro · Casa de Leilões'));
    expect(screen.getByRole('link', { name: 'Novo lote' })).toHaveAttribute(
      'href',
      '/painel/lotes/novo',
    );
    const resumo = screen.getByRole('region', { name: 'Resumo' });
    expect(await within(resumo).findByText('Total recebido')).toBeInTheDocument();
    const valores = within(resumo)
      .getAllByRole('definition')
      .map((d) => d.textContent);
    expect(valores).toEqual([expect.stringMatching(/^R\$\s0,00$/), '0', '0']);
    expect(within(resumo).getByText('Lotes arrematados')).toBeInTheDocument();
    expect(within(resumo).getByText('Lotes sem lance')).toBeInTheDocument();
    expect(await screen.findByText('Você ainda não criou lotes.')).toBeInTheDocument();
    expect(screen.queryByText('Lote criado.')).not.toBeInTheDocument();
  });

  it('lista com lote cancelado, arrematado e sem arremate', async () => {
    servidor.use(
      servirResumo({ totalRecebidoCentavos: 250_000, lotesArrematados: 1, lotesSemLance: 1 }),
      servirMeusLotes([
        criarLote({ id: 'a', titulo: 'Vivo', status: 'ao_vivo' }),
        criarLote({
          id: 'b',
          titulo: 'Vendido',
          status: 'encerrado',
          valorArremateCentavos: 250_000,
        }),
        criarLote({
          id: 'c',
          titulo: 'Encalhado',
          status: 'encerrado',
          totalLances: 0,
          lanceAtualCentavos: null,
        }),
        criarLote({ id: 'd', titulo: 'Desistido', status: 'cancelado' }),
      ]).handler,
    );
    abrir();

    const tabela = await screen.findByRole('table', { name: 'Meus lotes' });
    expect(
      within(tabela)
        .getAllByRole('columnheader')
        .map((c) => c.textContent),
    ).toEqual(['Lote', 'Status', 'Início', 'Fim', 'Lances', 'Resultado', 'Ações']);
    const linhas = within(tabela).getAllByRole('row').slice(1);
    expect(linhas).toHaveLength(4);
    expect(within(tabela).getByRole('link', { name: 'Vivo' })).toHaveAttribute('href', '/lotes/a');
    expect(linhas[0]).toHaveTextContent('Ao vivo');
    expect(linhas[0]).toHaveTextContent('—');
    expect(linhas[1]).toHaveTextContent(/Arrematado por R\$\s2\.500,00/);
    expect(linhas[2]).toHaveTextContent('Sem arremate');
    expect(linhas[3]).toHaveTextContent('Cancelado');
    expect(linhas[3]).toHaveTextContent('—');
    const resumo = screen.getByRole('region', { name: 'Resumo' });
    expect(await within(resumo).findByText(/^R\$\s2\.500,00$/)).toBeInTheDocument();
    for (const img of document.querySelectorAll('img')) {
      expect(img.getAttribute('src')).toMatch(/^\/api\/imagens\//);
    }
  });

  it('pagina pela URL e consulta a página pedida', async () => {
    const { handler, registro } = servirMeusLotes([criarLote()], 30);
    servidor.use(servirResumo(), handler);
    const user = userEvent.setup();
    const { router } = abrir();

    await screen.findByRole('table', { name: 'Meus lotes' });
    expect(screen.getByText('Página 1 de 2')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Próxima' }));
    expect(await screen.findByText('Página 2 de 2')).toBeInTheDocument();
    expect(router.state.location.search).toBe('?pagina=2');
    expect(registro.consultas.map((c) => c.get('pagina'))).toEqual(['1', '2']);
  });

  it('erro INDISPONIVEL mostra a mensagem e "Tentar de novo" refaz a consulta', async () => {
    servidor.use(
      servirResumo(),
      http.get(`${ORIGEM}/api/painel/lotes`, () => envelopeDeErro('INDISPONIVEL', 503)),
    );
    const user = userEvent.setup();
    abrir();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'O serviço está indisponível agora. Tente de novo em instantes.',
    );
    servidor.use(servirMeusLotes([criarLote({ id: 'x', titulo: 'Voltou' })]).handler);
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByRole('link', { name: 'Voltou' })).toBeInTheDocument();
  });

  it('mostra "Lote criado." só nesta visita e limpa o estado do histórico', async () => {
    servidor.use(servirResumo(), servirMeusLotes([]).handler);
    const { router } = abrir('/');
    await router.navigate('/painel', { state: { loteCriado: true } });

    expect(await screen.findByText('Lote criado.')).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.state).toBeNull());
  });

  it('licitante não acessa o painel', async () => {
    simularPreferenciaDoSistema(false);
    renderizarApp('/painel', { sessao: usuarioLicitante });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Acesso não permitido' }),
    ).toBeInTheDocument();
  });

  it.each([false, true])('axe sem violações sérias (tema escuro: %s)', async (escuro) => {
    servidor.use(
      servirResumo({ totalRecebidoCentavos: 1000, lotesArrematados: 1, lotesSemLance: 0 }),
      servirMeusLotes([criarLote({ status: 'cancelado' })]).handler,
    );
    abrir('/painel', escuro);
    await screen.findByRole('table', { name: 'Meus lotes' });
    await screen.findByText('Total recebido');
    expect(await violacoesSerias(document.body)).toEqual([]);
  });
});
