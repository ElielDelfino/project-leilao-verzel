import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { violacoesSerias } from '../apoio/axe';
import { criarLote, servirLotes } from '../apoio/fixtures-lotes';
import { simularPreferenciaDoSistema } from '../apoio/matchMedia';
import { renderizarApp } from '../apoio/renderizarApp';
import { envelopeDeErro, ORIGEM, servidor } from '../apoio/servidor';

function abrir(url = '/') {
  simularPreferenciaDoSistema(false);
  return renderizarApp(url);
}

const pesquisa = (router: ReturnType<typeof abrir>['router']) => router.state.location.search;

describe('/ (vitrine)', () => {
  it('mostra título, aba padrão, total e o cartão do lote com os textos exatos', async () => {
    const { handler, registro } = servirLotes([criarLote()]);
    servidor.use(handler);
    abrir();

    expect(await screen.findByRole('heading', { level: 1, name: 'Vitrine' })).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe('Vitrine · Casa de Leilões'));
    expect(screen.getByRole('tab', { name: 'Ao vivo' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Agendados' })).toHaveAttribute(
      'aria-selected',
      'false',
    );

    const painel = screen.getByRole('tabpanel');
    expect(await within(painel).findByText('1 lote encontrado')).toHaveAttribute(
      'aria-live',
      'polite',
    );
    const item = within(painel).getByRole('listitem');
    expect(
      within(item).getByRole('heading', { level: 2, name: 'Black Lotus em estado raro' }),
    ).toBeInTheDocument();
    expect(within(item).getByRole('link')).toHaveAttribute(
      'href',
      '/lotes/0192f3a0-0000-7000-8000-000000000101',
    );
    expect(within(item).getByText('Rara')).toBeInTheDocument();
    expect(within(item).getByText(/^Lance atual: R\$\s1\.234,56$/)).toBeInTheDocument();
    expect(within(item).getByText('3 lances')).toBeInTheDocument();
    expect(within(item).getByText(/^Termina em 26\/10\/2026,? 12:30$/)).toBeInTheDocument();
    expect(Object.fromEntries(registro.consultas[0] ?? [])).toEqual({
      status: 'ao_vivo',
      ordem: 'termina_antes',
      pagina: '1',
    });
  });

  it('imagem com alt, sem filtro nem sobreposição, e proporção reservada', async () => {
    servidor.use(servirLotes([criarLote()]).handler);
    abrir();

    const imagem = await screen.findByRole('img', { name: 'Carta Black Lotus' });
    expect(imagem).toHaveAttribute('src', '/api/imagens/0192f3a0-0000-7000-8000-0000000002a1');
    expect(imagem).toHaveAttribute('loading', 'lazy');
    expect(imagem).toHaveAttribute('width');
    expect(imagem).toHaveAttribute('height');
    expect(imagem.className).toContain('object-contain');
    expect(imagem.className).not.toMatch(/blur|filter|opacity|absolute/);
  });

  it.each([
    [
      'encerrado com arremate',
      { status: 'encerrado', valorArremateCentavos: 150_000 } as const,
      /^Arrematado por R\$\s1\.500,00$/,
      /^Encerrado em 26\/10\/2026,? 12:30$/,
    ],
    [
      'encerrado sem lances',
      { status: 'encerrado', lanceAtualCentavos: null, totalLances: 0 } as const,
      /^Encerrado sem lances$/,
      /^Encerrado em /,
    ],
    [
      'agendado sem lance',
      { status: 'agendado', lanceAtualCentavos: null, totalLances: 0 } as const,
      /^Lance inicial: R\$\s100,00$/,
      /^Começa em 24\/10\/2026,? 10:00$/,
    ],
  ])('linhas de preço e horário: %s', async (_nome, sobrescritas, preco, horario) => {
    servidor.use(servirLotes([criarLote(sobrescritas)]).handler);
    abrir('/?status=encerrado');

    const item = await screen.findByRole('listitem');
    expect(within(item).getByText(preco)).toBeInTheDocument();
    expect(within(item).getByText(horario)).toBeInTheDocument();
  });

  it('"Nenhum lance" e "1 lance"', async () => {
    servidor.use(
      servirLotes([
        criarLote({ id: 'a', totalLances: 0, lanceAtualCentavos: null }),
        criarLote({ id: 'b', totalLances: 1 }),
      ]).handler,
    );
    abrir();

    expect(await screen.findByText('Nenhum lance')).toBeInTheDocument();
    expect(screen.getByText('1 lance')).toBeInTheDocument();
    expect(screen.getByText('2 lotes encontrados')).toBeInTheDocument();
  });

  it('trocar de aba aplica na hora, volta à página 1 e grava status na URL', async () => {
    const { handler, registro } = servirLotes([criarLote()]);
    servidor.use(handler);
    const user = userEvent.setup();
    const { router } = abrir('/?pagina=1');
    await screen.findByRole('listitem');

    await user.click(screen.getByRole('tab', { name: 'Agendados' }));
    await waitFor(() => expect(pesquisa(router)).toBe('?status=agendado'));
    await waitFor(() => expect(registro.consultas.at(-1)?.get('status')).toBe('agendado'));
    expect(screen.getByRole('tab', { name: 'Agendados' })).toHaveAttribute('aria-selected', 'true');

    await user.click(screen.getByRole('tab', { name: 'Ao vivo' }));
    await waitFor(() => expect(pesquisa(router)).toBe(''));
  });

  it('reconstrói abas, filtros, ordem e página a partir da URL (recarregar mantém)', async () => {
    const { handler, registro } = servirLotes([criarLote()], 60);
    servidor.use(handler);
    abrir(
      '/?status=encerrado&q=lotus&raridade=rare&precoMin=1000&precoMax=255000&ordem=maior_lance&pagina=2',
    );

    await screen.findByRole('listitem');
    expect(screen.getByRole('tab', { name: 'Encerrados' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByLabelText('Buscar por título ou carta')).toHaveValue('lotus');
    expect(screen.getByLabelText('Raridade')).toHaveValue('rare');
    expect(screen.getByLabelText('Preço mínimo (R$)')).toHaveValue('10,00');
    expect(screen.getByLabelText('Preço máximo (R$)')).toHaveValue('2.550,00');
    expect(screen.getByLabelText('Ordenar por')).toHaveValue('maior_lance');
    expect(screen.getByText('Página 2 de 3')).toBeInTheDocument();
    expect(Object.fromEntries(registro.consultas[0] ?? [])).toEqual({
      status: 'encerrado',
      q: 'lotus',
      raridade: 'rare',
      precoMin: '1000',
      precoMax: '255000',
      ordem: 'maior_lance',
      pagina: '2',
    });
  });

  it('ignora parâmetros desconhecidos ou inválidos na URL', async () => {
    const { handler, registro } = servirLotes([criarLote()]);
    servidor.use(handler);
    abrir('/?status=cancelado&raridade=lendaria&precoMin=abc&ordem=x&pagina=-3&foo=1');

    await screen.findByRole('listitem');
    expect(Object.fromEntries(registro.consultas[0] ?? [])).toEqual({
      status: 'ao_vivo',
      ordem: 'termina_antes',
      pagina: '1',
    });
  });

  it('Filtrar envia busca, raridade e preços em centavos e volta à página 1', async () => {
    servidor.use(servirLotes([criarLote()], 60).handler);
    const user = userEvent.setup();
    const { router } = abrir('/?pagina=2');
    await screen.findByRole('listitem');

    await user.type(screen.getByLabelText('Buscar por título ou carta'), '  lotus ');
    await user.selectOptions(screen.getByLabelText('Raridade'), 'Mítica');
    await user.type(screen.getByLabelText('Preço mínimo (R$)'), '1.234,5');
    await user.type(screen.getByLabelText('Preço máximo (R$)'), '5000');
    await user.click(screen.getByRole('button', { name: 'Filtrar' }));

    await waitFor(() =>
      expect(pesquisa(router)).toBe('?q=lotus&raridade=mythic&precoMin=123450&precoMax=500000'),
    );
  });

  it('texto só com espaços não filtra', async () => {
    servidor.use(servirLotes([criarLote()]).handler);
    const user = userEvent.setup();
    const { router } = abrir('/?ordem=mais_recente');
    await screen.findByRole('listitem');

    await user.type(screen.getByLabelText('Buscar por título ou carta'), '   ');
    await user.click(screen.getByRole('button', { name: 'Filtrar' }));

    await waitFor(() => expect(pesquisa(router)).toBe('?ordem=mais_recente'));
  });

  it('o formulário é uma busca e o campo limita o texto a 100 caracteres', async () => {
    servidor.use(servirLotes([criarLote()]).handler);
    abrir();
    await screen.findByRole('listitem');

    const campo = screen.getByRole('searchbox', { name: 'Buscar por título ou carta' });
    expect(campo).toHaveAttribute('maxlength', '100');
    expect(screen.getByRole('search')).toBeInTheDocument();
  });

  it('preço mal formado ou fora do limite mostra a mensagem e não consulta', async () => {
    const { handler, registro } = servirLotes([criarLote()]);
    servidor.use(handler);
    const user = userEvent.setup();
    abrir();
    await screen.findByRole('listitem');
    const antes = registro.consultas.length;

    await user.type(screen.getByLabelText('Preço mínimo (R$)'), '12,345');
    await user.type(screen.getByLabelText('Preço máximo (R$)'), '100.000.000,01');
    await user.click(screen.getByRole('button', { name: 'Filtrar' }));

    const mensagem = 'Informe um valor entre R$ 0,00 e R$ 100.000.000,00.';
    expect(await screen.findAllByText(mensagem)).toHaveLength(2);
    const minimo = screen.getByLabelText('Preço mínimo (R$)');
    expect(minimo).toHaveAttribute('aria-invalid', 'true');
    expect(minimo).toHaveAccessibleDescription(mensagem);
    expect(minimo).toHaveFocus();
    expect(registro.consultas).toHaveLength(antes);
  });

  it('máximo menor que o mínimo: mensagem no campo do máximo', async () => {
    servidor.use(servirLotes([criarLote()]).handler);
    const user = userEvent.setup();
    abrir();
    await screen.findByRole('listitem');

    await user.type(screen.getByLabelText('Preço mínimo (R$)'), '50');
    await user.type(screen.getByLabelText('Preço máximo (R$)'), '10');
    await user.click(screen.getByRole('button', { name: 'Filtrar' }));

    expect(screen.getByLabelText('Preço máximo (R$)')).toHaveAccessibleDescription(
      'O preço máximo deve ser maior ou igual ao mínimo.',
    );
    expect(screen.getByLabelText('Preço mínimo (R$)')).not.toHaveAttribute('aria-invalid');
  });

  it('Limpar filtros remove q, raridade e preços e mantém aba e ordenação', async () => {
    servidor.use(servirLotes([criarLote()]).handler);
    const user = userEvent.setup();
    const { router } = abrir(
      '/?status=agendado&q=a&raridade=rare&precoMin=100&precoMax=200&ordem=mais_recente&pagina=2',
    );
    await screen.findByRole('listitem');

    await user.click(screen.getByRole('button', { name: 'Limpar filtros' }));

    await waitFor(() => expect(pesquisa(router)).toBe('?status=agendado&ordem=mais_recente'));
    await waitFor(() =>
      expect(screen.getByLabelText('Buscar por título ou carta')).toHaveValue(''),
    );
  });

  it('ordenar aplica na hora', async () => {
    const { handler, registro } = servirLotes([criarLote()]);
    servidor.use(handler);
    const user = userEvent.setup();
    const { router } = abrir('/?pagina=1');
    await screen.findByRole('listitem');

    const opcoes = within(screen.getByLabelText('Ordenar por')).getAllByRole('option');
    expect(opcoes.map((o) => o.textContent)).toEqual([
      'Termina antes',
      'Mais recente',
      'Maior lance',
    ]);
    await user.selectOptions(screen.getByLabelText('Ordenar por'), 'Maior lance');

    await waitFor(() => expect(pesquisa(router)).toBe('?ordem=maior_lance'));
    await waitFor(() => expect(registro.consultas.at(-1)?.get('ordem')).toBe('maior_lance'));
  });

  it('carregando: status "Carregando lotes…" e lista com aria-busy', async () => {
    servidor.use(http.get(`${ORIGEM}/api/lotes`, () => new Promise<Response>(() => undefined)));
    abrir();

    expect(await screen.findByRole('status')).toHaveTextContent('Carregando lotes…');
    expect(screen.getByRole('list')).toHaveAttribute('aria-busy', 'true');
  });

  it.each([
    ['/', 'Nenhum lote ao vivo agora.'],
    ['/?status=agendado', 'Nenhum lote agendado.'],
    ['/?status=encerrado', 'Nenhum lote encerrado ainda.'],
  ])('vazio sem filtros em %s', async (url, texto) => {
    servidor.use(servirLotes([]).handler);
    abrir(url);

    expect(await screen.findByText(texto)).toBeInTheDocument();
    expect(screen.queryByText(/lotes? encontrados?/)).not.toBeInTheDocument();
  });

  it('vazio com filtros oferece "Limpar filtros" no painel', async () => {
    servidor.use(servirLotes([]).handler);
    const user = userEvent.setup();
    const { router } = abrir('/?q=zzz');

    const painel = screen.getByRole('tabpanel');
    expect(
      await within(painel).findByText('Nenhum lote encontrado com estes filtros.'),
    ).toBeInTheDocument();
    await user.click(within(painel).getByRole('button', { name: 'Limpar filtros' }));
    await waitFor(() => expect(pesquisa(router)).toBe(''));
  });

  it('falha da consulta mostra a mensagem do código e "Tentar de novo" refaz a consulta', async () => {
    servidor.use(http.get(`${ORIGEM}/api/lotes`, () => envelopeDeErro('INDISPONIVEL', 503)));
    const user = userEvent.setup();
    abrir();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'O serviço está indisponível agora. Tente de novo em instantes.',
    );
    servidor.use(servirLotes([criarLote()]).handler);
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }));

    expect(await screen.findByRole('listitem')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('falha do refetch com a lista em tela mantém os cards e mostra o aviso com "Tentar de novo"', async () => {
    servidor.use(servirLotes([criarLote()]).handler);
    const user = userEvent.setup();
    abrir();
    await screen.findByRole('listitem');

    servidor.use(http.get(`${ORIGEM}/api/lotes`, () => envelopeDeErro('INDISPONIVEL', 503)));
    window.dispatchEvent(new Event('visibilitychange'));

    const aviso = await screen.findByRole('alert');
    expect(aviso).toHaveTextContent(
      'Não foi possível atualizar a lista. O serviço está indisponível agora. Tente de novo em instantes.',
    );
    expect(screen.getByRole('listitem')).toBeInTheDocument();
    expect(screen.queryByText('Carregando lotes…')).not.toBeInTheDocument();

    servidor.use(servirLotes([criarLote()]).handler);
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }));

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(screen.getByRole('listitem')).toBeInTheDocument();
  });

  it('o foco não se perde ao tentar de novo depois da falha do refetch', async () => {
    servidor.use(servirLotes([criarLote()]).handler);
    const user = userEvent.setup();
    abrir();
    await screen.findByRole('listitem');

    servidor.use(http.get(`${ORIGEM}/api/lotes`, () => envelopeDeErro('INDISPONIVEL', 503)));
    window.dispatchEvent(new Event('visibilitychange'));
    await screen.findByRole('alert');

    // A nova tentativa também falha: o botão continua o mesmo, com o foco.
    const botao = screen.getByRole('button', { name: 'Tentar de novo' });
    await user.click(botao);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBe(botao));
    expect(botao).toHaveFocus();
    expect(screen.getByRole('listitem')).toBeInTheDocument();
  });

  it('falha de rede também mostra a mensagem de indisponível', async () => {
    servidor.use(http.get(`${ORIGEM}/api/lotes`, () => HttpResponse.error()));
    abrir();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'O serviço está indisponível agora. Tente de novo em instantes.',
    );
  });

  it('paginação: rótulos, pontas com aria-disabled e navegação', async () => {
    const { handler, registro } = servirLotes([criarLote()], 50);
    servidor.use(handler);
    const user = userEvent.setup();
    const { router } = abrir();
    await screen.findByRole('listitem');

    const nav = screen.getByRole('navigation', { name: 'Paginação' });
    expect(within(nav).getByText('Página 1 de 3')).toBeInTheDocument();
    const anterior = within(nav).getByRole('button', { name: 'Anterior' });
    expect(anterior).toHaveAttribute('aria-disabled', 'true');
    await user.click(anterior);
    expect(pesquisa(router)).toBe('');

    await user.click(within(nav).getByRole('button', { name: 'Próxima' }));
    await waitFor(() => expect(pesquisa(router)).toBe('?pagina=2'));
    await waitFor(() => expect(registro.consultas.at(-1)?.get('pagina')).toBe('2'));
    expect(await screen.findByText('Página 2 de 3')).toBeInTheDocument();
  });

  it('sem paginação com uma página só', async () => {
    servidor.use(servirLotes([criarLote()], 24).handler);
    abrir();
    await screen.findByRole('listitem');

    expect(screen.queryByRole('navigation', { name: 'Paginação' })).not.toBeInTheDocument();
  });

  it('última página: "Próxima" não navega', async () => {
    servidor.use(servirLotes([criarLote()], 50).handler);
    const user = userEvent.setup();
    const { router } = abrir('/?pagina=3');
    await screen.findByRole('listitem');

    const proxima = screen.getByRole('button', { name: 'Próxima' });
    expect(proxima).toHaveAttribute('aria-disabled', 'true');
    await user.click(proxima);
    expect(pesquisa(router)).toBe('?pagina=3');
  });

  it('página acima da última troca a URL, sem nova entrada, para a última', async () => {
    servidor.use(servirLotes([criarLote()], 50).handler);
    const { router } = abrir('/?pagina=9');

    await waitFor(() => expect(pesquisa(router)).toBe('?pagina=3'));
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it.each(['claro', 'escuro'])('axe sem violações sérias no tema %s', async (tema) => {
    servidor.use(servirLotes([criarLote()], 50).handler);
    if (tema === 'escuro') document.documentElement.dataset['theme'] = 'dark';
    abrir();
    await screen.findByRole('listitem');

    expect(await violacoesSerias()).toEqual([]);
  });
});
