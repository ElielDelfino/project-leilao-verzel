import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import { describe, expect, it } from 'vitest';

import { violacoesSerias } from '../apoio/axe';
import { criarLoteDetalhe, servirDetalhe } from '../apoio/fixtures-lotes';
import { simularPreferenciaDoSistema } from '../apoio/matchMedia';
import { renderizarApp } from '../apoio/renderizarApp';
import { envelopeDeErro, ORIGEM, servidor } from '../apoio/servidor';

const ID = '0192f3a0-0000-7000-8000-000000000101';

function abrir(id = ID) {
  simularPreferenciaDoSistema(false);
  return renderizarApp(`/lotes/${id}`);
}

describe('/lotes/:id (detalhe)', () => {
  it('mostra título, imagem, dados da carta e dados do lote com os textos exatos', async () => {
    servidor.use(servirDetalhe(criarLoteDetalhe()));
    abrir();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Black Lotus em estado raro' }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(document.title).toBe('Black Lotus em estado raro · Casa de Leilões'),
    );

    const imagem = screen.getByRole('img', { name: 'Carta Black Lotus' });
    expect(imagem).toHaveAttribute('src', '/api/imagens/0192f3a0-0000-7000-8000-0000000002a1');
    expect(imagem.className).toContain('object-contain');
    expect(screen.getByText('Ilustração: Christopher Rush')).toBeInTheDocument();

    expect(screen.getByText('Carta: Black Lotus')).toBeInTheDocument();
    expect(screen.getByText('Coleção: Limited Edition Alpha')).toBeInTheDocument();
    expect(screen.getByText('Raridade: Rara')).toBeInTheDocument();
    expect(screen.getByText('Tipo: Artifact')).toBeInTheDocument();
    expect(
      screen.getByText('{T}, Sacrifice Black Lotus: Add three mana of any one color.'),
    ).toBeInTheDocument();

    expect(screen.getByText('Ao vivo')).toBeInTheDocument();
    expect(screen.getByText('Descrição')).toBeInTheDocument();
    expect(screen.getByText('Carta em ótimo estado.')).toBeInTheDocument();
    expect(screen.getByText(/^Lance inicial: R\$\s100,00$/)).toBeInTheDocument();
    expect(screen.getByText(/^Incremento mínimo: R\$\s5,00$/)).toBeInTheDocument();
    expect(screen.getByText(/^Lance atual: R\$\s1\.234,56$/)).toBeInTheDocument();
    expect(screen.getByText('3 lances')).toBeInTheDocument();
    expect(screen.getByText(/^Início: 24\/10\/2026,? 10:00$/)).toBeInTheDocument();
    expect(screen.getByText(/^Fim: 26\/10\/2026,? 12:30$/)).toBeInTheDocument();
    expect(screen.queryByText(/Fim original/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /lance/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Voltar à vitrine' })).toHaveAttribute('href', '/');
  });

  it('enquanto carrega: status "Carregando lote…" e <title> "Lote"', async () => {
    servidor.use(
      http.get(`${ORIGEM}/api/lotes/${ID}`, () => new Promise<Response>(() => undefined)),
    );
    abrir();

    expect(await screen.findByRole('status')).toHaveTextContent('Carregando lote…');
    await waitFor(() => expect(document.title).toBe('Lote · Casa de Leilões'));
  });

  it('sem lance: "Nenhum lance ainda." e "Nenhum lance"; sem descrição, artista nem oráculo', async () => {
    const base = criarLoteDetalhe();
    servidor.use(
      servirDetalhe(
        criarLoteDetalhe({
          lanceAtualCentavos: null,
          totalLances: 0,
          descricao: null,
          carta: { ...base.carta, artista: null, textoOracle: null },
        }),
      ),
    );
    abrir();

    expect(await screen.findByText('Nenhum lance ainda.')).toBeInTheDocument();
    expect(screen.getByText('Nenhum lance')).toBeInTheDocument();
    expect(screen.queryByText(/^Lance atual/)).not.toBeInTheDocument();
    expect(screen.queryByText('Descrição')).not.toBeInTheDocument();
    expect(screen.queryByText(/^Ilustração/)).not.toBeInTheDocument();
  });

  it('"1 lance" e "Fim original" só quando difere do fim', async () => {
    servidor.use(
      servirDetalhe(criarLoteDetalhe({ totalLances: 1, fimOriginalEm: '2026-10-26T15:00:00Z' })),
    );
    abrir();

    expect(await screen.findByText('1 lance')).toBeInTheDocument();
    expect(screen.getByText(/^Fim original: 26\/10\/2026,? 12:00$/)).toBeInTheDocument();
  });

  it.each([
    ['ganhando', 'Você está ganhando este lote.'],
    ['venceu', 'Você venceu este lote.'],
  ] as const)('suaPosicao %s mostra "%s"', async (suaPosicao, texto) => {
    servidor.use(servirDetalhe(criarLoteDetalhe({ suaPosicao })));
    abrir();

    expect(await screen.findByText(texto)).toBeInTheDocument();
  });

  it('suaPosicao null não mostra mensagem de posição', async () => {
    servidor.use(servirDetalhe(criarLoteDetalhe()));
    abrir();

    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByText(/Você (está ganhando|venceu)/)).not.toBeInTheDocument();
  });

  it('lote cancelado: status com texto e ícone, e aviso com role="status"', async () => {
    servidor.use(servirDetalhe(criarLoteDetalhe({ status: 'cancelado' })));
    abrir();

    expect(await screen.findByText('Este lote foi cancelado.')).toHaveAttribute('role', 'status');
    // Cor não é o único sinal: o rótulo vem com ícone (decorativo) e texto.
    const status = screen.getByText(/Cancelado$/);
    expect(status.textContent).toMatch(/^\S\s+Cancelado$/);
    expect(status.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it('lote inexistente: "Lote não encontrado" com a mensagem e o link, dentro do layout', async () => {
    servidor.use(
      http.get(`${ORIGEM}/api/lotes/${ID}`, () => envelopeDeErro('NAO_ENCONTRADO', 404)),
    );
    abrir();

    const titulo = await screen.findByRole('heading', { level: 1, name: 'Lote não encontrado' });
    const conteudo = screen.getByRole('main');
    expect(conteudo).toContainElement(titulo);
    expect(within(conteudo).getByText('Não encontramos o que você procurou.')).toBeInTheDocument();
    expect(within(conteudo).getByRole('link', { name: 'Voltar à vitrine' })).toHaveAttribute(
      'href',
      '/',
    );
    expect(screen.getByRole('banner')).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe('Lote não encontrado · Casa de Leilões'));
  });

  it('falha de infraestrutura mostra a mensagem e "Tentar de novo"', async () => {
    servidor.use(http.get(`${ORIGEM}/api/lotes/${ID}`, () => envelopeDeErro('INDISPONIVEL', 503)));
    const user = userEvent.setup();
    abrir();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'O serviço está indisponível agora. Tente de novo em instantes.',
    );
    servidor.use(servirDetalhe(criarLoteDetalhe()));
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }));

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Black Lotus em estado raro' }),
    ).toBeInTheDocument();
  });

  it.each(['claro', 'escuro'])('axe sem violações sérias no tema %s', async (tema) => {
    servidor.use(servirDetalhe(criarLoteDetalhe({ suaPosicao: 'ganhando' })));
    if (tema === 'escuro') document.documentElement.dataset['theme'] = 'dark';
    abrir();
    await screen.findByRole('heading', { level: 1, name: 'Black Lotus em estado raro' });

    expect(await violacoesSerias()).toEqual([]);
  });
});
