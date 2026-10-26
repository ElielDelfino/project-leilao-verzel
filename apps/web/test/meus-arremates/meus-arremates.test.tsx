import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import type { SchemasApi } from '@leilao/contracts';

import { violacoesSerias } from '../apoio/axe';
import { criarLote } from '../apoio/fixtures-lotes';
import { simularPreferenciaDoSistema } from '../apoio/matchMedia';
import { renderizarApp } from '../apoio/renderizarApp';
import { ORIGEM, servidor, usuarioLicitante } from '../apoio/servidor';

type LanceDoUsuario = SchemasApi['LanceDoUsuario'];
type Arremate = SchemasApi['Arremate'];

const idDoLote = (n: number) => `0192f3a0-0000-7000-8000-${String(n).padStart(12, '0')}`;

function lance(n: number, sobrescritas: Partial<LanceDoUsuario> = {}): LanceDoUsuario {
  return {
    lote: criarLote({ id: idDoLote(n), titulo: `Lote ${n}` }),
    posicao: 'ganhando',
    meuMaiorLanceCentavos: 123_456,
    meuUltimoLanceEm: '2026-10-24T13:00:00Z',
    ...sobrescritas,
  };
}

function arremate(n: number): Arremate {
  return {
    codigo: `k3Zt9QmW2xVbN7a${n}`,
    valorCentavos: 16_500,
    carta: {
      nome: `Carta ${n}`,
      imagemUrl: '/api/imagens/0192f3a0-0000-7000-8000-0000000002a1',
    },
    emitidoEm: '2026-10-27T14:30:00Z',
    auditoriaUrl: `/auditoria/${idDoLote(n)}`,
  };
}

interface Resultado<T> {
  itens: T[];
  total: number;
}

/** Serve `GET /api/me/{caminho}`; `resolver` pode ser assíncrono para segurar a resposta. */
function servir<T>(
  caminho: 'lances' | 'arremates',
  resolver: (pagina: number) => Resultado<T> | Promise<Resultado<T>>,
): number[] {
  const paginasPedidas: number[] = [];
  servidor.use(
    http.get(`${ORIGEM}/api/me/${caminho}`, async ({ request }) => {
      const pagina = Number(new URL(request.url).searchParams.get('pagina')) || 1;
      paginasPedidas.push(pagina);
      const { itens, total } = await resolver(pagina);
      return HttpResponse.json({
        sucesso: true,
        dados: itens,
        meta: { total, pagina, limite: 24 },
      });
    }),
  );
  return paginasPedidas;
}

function itemDe(itens: HTMLElement[], indice: number) {
  const item = itens[indice];
  if (!item) throw new Error(`Sem item na posição ${indice}`);
  return within(item);
}

const abrir = (url = '/meus-arremates') => renderizarApp(url, { sessao: usuarioLicitante });

describe('/meus-arremates', () => {
  it('"Meus lances" é a aba padrão e mostra cada posição com rótulo, valor e link para a sala', async () => {
    simularPreferenciaDoSistema(false);
    servir('lances', () => ({
      itens: [
        lance(1, { posicao: 'ganhando' }),
        lance(2, { posicao: 'superado', meuMaiorLanceCentavos: 5_000 }),
        lance(3, { posicao: 'venceu' }),
        lance(4, { posicao: 'perdeu' }),
      ],
      total: 4,
    }));
    abrir();

    const lista = await screen.findByRole('list', { name: 'Meus lances' });
    const itens = within(lista).getAllByRole('listitem');
    expect(itens).toHaveLength(4);
    const rotulos = ['Você está ganhando', 'Você foi superado', 'Você venceu', 'Você não venceu'];
    rotulos.forEach((rotulo, i) => {
      const rotuloNaTela = itemDe(itens, i).getByText(rotulo);
      expect(rotuloNaTela).toBeVisible();
      // Sempre ícone + texto: o SVG decorativo fica ao lado do texto.
      const icone = rotuloNaTela.querySelector('svg');
      expect(icone).toHaveAttribute('aria-hidden', 'true');
    });
    expect(itemDe(itens, 0).getByText('Seu maior lance: R$ 1.234,56')).toBeVisible();
    expect(itemDe(itens, 1).getByText('Seu maior lance: R$ 50,00')).toBeVisible();
    const titulo = itemDe(itens, 1).getByRole('heading', { level: 2 });
    expect(within(titulo).getByRole('link', { name: 'Lote 2' })).toHaveAttribute(
      'href',
      `/lotes/${idDoLote(2)}`,
    );
    expect(itemDe(itens, 1).queryByText(/Ir para a sala|Último lance em/)).not.toBeInTheDocument();
    expect(itemDe(itens, 0).getByAltText('Carta Black Lotus')).toHaveAttribute(
      'src',
      '/api/imagens/0192f3a0-0000-7000-8000-0000000002a1',
    );
    expect(screen.getByRole('tab', { name: 'Meus lances', selected: true })).toBeVisible();
  });

  it('aba "Arrematados" lista os arremates com links para o comprovante e a auditoria', async () => {
    simularPreferenciaDoSistema(false);
    servir('lances', () => ({ itens: [lance(1)], total: 1 }));
    servir('arremates', () => ({ itens: [arremate(1)], total: 1 }));
    const usuario = userEvent.setup();
    const { router } = abrir();

    await screen.findByRole('list', { name: 'Meus lances' });
    await usuario.click(screen.getByRole('tab', { name: 'Arrematados' }));

    const lista = await screen.findByRole('list', { name: 'Arrematados' });
    expect(screen.queryByRole('list', { name: 'Meus lances' })).not.toBeInTheDocument();
    expect(within(lista).getByRole('heading', { level: 2, name: 'Carta 1' })).toBeVisible();
    expect(within(lista).getByAltText('Carta Carta 1')).toHaveAttribute(
      'src',
      '/api/imagens/0192f3a0-0000-7000-8000-0000000002a1',
    );
    expect(within(lista).getByText('Valor do arremate: R$ 165,00')).toBeVisible();
    expect(within(lista).getByText(/^Emitido em .*2026/)).toBeVisible();
    expect(within(lista).getByRole('link', { name: /Ver comprovante/ })).toHaveAttribute(
      'href',
      '/comprovantes/k3Zt9QmW2xVbN7a1',
    );
    expect(within(lista).getByRole('link', { name: /Ver auditoria/ })).toHaveAttribute(
      'href',
      `/auditoria/${idDoLote(1)}`,
    );
    expect(router.state.location.search).toBe('?aba=arrematados');
  });

  it('nunca usa no DOM a imagem do servidor fora de /api/imagens/{uuid}: mostra "Sem imagem"', async () => {
    simularPreferenciaDoSistema(false);
    const externa = 'https://cards.scryfall.io/large/front/a/b/ab.jpg';
    servir('lances', () => ({
      itens: [
        lance(1, { lote: criarLote({ id: idDoLote(1), titulo: 'Lote 1', imagemUrl: externa }) }),
      ],
      total: 1,
    }));
    const { container } = abrir();

    await screen.findByText('Lote 1');
    expect(screen.getByText('Sem imagem')).toBeVisible();
    expect(container.querySelector('img')).toBeNull();
    expect(container.innerHTML).not.toContain('cards.scryfall.io');
  });

  it('imagem válida é remontada como /api/imagens/{uuid}', async () => {
    simularPreferenciaDoSistema(false);
    servir('lances', () => ({ itens: [lance(1)], total: 1 }));
    const { container } = abrir();

    await screen.findByText('Lote 1');
    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      '/api/imagens/0192f3a0-0000-7000-8000-0000000002a1',
    );
  });

  it('auditoriaUrl malformada não gera link e o código do comprovante é codificado', async () => {
    simularPreferenciaDoSistema(false);
    servir('lances', () => ({ itens: [lance(1)], total: 1 }));
    servir('arremates', () => ({
      itens: [
        {
          ...arremate(1),
          codigo: 'a/b?c#d',
          auditoriaUrl: `/auditoria/${'-'.repeat(36)}`,
        },
      ],
      total: 1,
    }));
    const usuario = userEvent.setup();
    abrir();

    await screen.findByText('Lote 1');
    await usuario.click(screen.getByRole('tab', { name: 'Arrematados' }));

    const lista = await screen.findByRole('list', { name: 'Arrematados' });
    expect(within(lista).queryByRole('link', { name: /Ver auditoria/ })).not.toBeInTheDocument();
    expect(within(lista).getByRole('link', { name: /Ver comprovante/ })).toHaveAttribute(
      'href',
      '/comprovantes/a%2Fb%3Fc%23d',
    );
  });

  it('imagem externa de um arremate também vira "Sem imagem", sem <img>', async () => {
    simularPreferenciaDoSistema(false);
    servir('lances', () => ({ itens: [lance(1)], total: 1 }));
    servir('arremates', () => ({
      itens: [
        {
          ...arremate(1),
          carta: { nome: 'Carta 1', imagemUrl: 'https://cards.scryfall.io/large/front/a/b/ab.jpg' },
        },
      ],
      total: 1,
    }));
    const usuario = userEvent.setup();
    abrir();

    await screen.findByText('Lote 1');
    await usuario.click(screen.getByRole('tab', { name: 'Arrematados' }));

    const lista = await screen.findByRole('list', { name: 'Arrematados' });
    expect(within(lista).getByText('Sem imagem')).toBeVisible();
    expect(within(lista).queryByRole('img')).not.toBeInTheDocument();
  });

  it('id de lote que não é UUID não gera link para a sala', async () => {
    simularPreferenciaDoSistema(false);
    servir('lances', () => ({
      itens: [lance(1, { lote: criarLote({ id: '../admin', titulo: 'Lote 1' }) })],
      total: 1,
    }));
    abrir();

    await screen.findByText('Lote 1');
    expect(screen.getByRole('heading', { level: 2, name: 'Lote 1' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Lote 1' })).not.toBeInTheDocument();
  });

  it('a URL reconstrói a tela: aba e página vêm de ?aba= e ?pagina=', async () => {
    simularPreferenciaDoSistema(false);
    const paginas = servir('arremates', (pagina) => ({ itens: [arremate(pagina)], total: 50 }));
    abrir('/meus-arremates?aba=arrematados&pagina=2');

    expect(await screen.findByText('Carta 2')).toBeVisible();
    expect(paginas).toEqual([2]);
    expect(screen.getByRole('tab', { name: 'Arrematados', selected: true })).toBeVisible();
    expect(screen.getByText('Página 2 de 3')).toBeVisible();
  });

  it.each([['?aba=outra&pagina=abc'], ['?pagina=0'], ['?pagina=-3'], ['?pagina=1.5']])(
    'parâmetros inválidos %s caem em "Meus lances", página 1',
    async (consulta) => {
      simularPreferenciaDoSistema(false);
      const paginas = servir('lances', () => ({ itens: [lance(1)], total: 1 }));
      abrir(`/meus-arremates${consulta}`);

      await screen.findByRole('list', { name: 'Meus lances' });
      expect(paginas).toEqual([1]);
    },
  );

  it('pagina mantendo a lista anterior e o foco no botão enquanto a nova página carrega', async () => {
    simularPreferenciaDoSistema(false);
    let liberar: () => void = () => undefined;
    const portao = new Promise<void>((resolver) => (liberar = resolver));
    servir('lances', async (pagina) => {
      if (pagina === 2) await portao;
      return { itens: [lance(pagina)], total: 30 };
    });
    const usuario = userEvent.setup();
    const { router } = abrir();

    expect(await screen.findByText('Lote 1')).toBeVisible();
    const proxima = screen.getByRole('button', { name: 'Próxima' });
    await usuario.click(proxima);

    await waitFor(() => expect(router.state.location.search).toBe('?pagina=2'));
    // Sem piscar: a página 1 segue na tela, marcada como ocupada, e o foco não sai do botão.
    expect(screen.getByText('Lote 1')).toBeVisible();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Meus lances' })).toHaveAttribute('aria-busy', 'true');
    expect(proxima).toHaveFocus();

    liberar();
    expect(await screen.findByText('Lote 2')).toBeVisible();
    expect(screen.queryByText('Lote 1')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Próxima' })).toBe(proxima);
    expect(proxima).toHaveFocus();
    expect(screen.getByText('Página 2 de 2')).toBeVisible();
    expect(proxima).toHaveAttribute('aria-disabled', 'true');

    await usuario.click(screen.getByRole('button', { name: 'Anterior' }));
    await waitFor(() => expect(router.state.location.search).toBe(''));
    expect(await screen.findByText('Lote 1')).toBeVisible();
  });

  it('na primeira página "Anterior" fica inerte, mas continua focável', async () => {
    simularPreferenciaDoSistema(false);
    const paginas = servir('lances', () => ({ itens: [lance(1)], total: 30 }));
    const usuario = userEvent.setup();
    const { router } = abrir();

    await screen.findByText('Lote 1');
    const anterior = screen.getByRole('button', { name: 'Anterior' });
    expect(anterior).toHaveAttribute('aria-disabled', 'true');
    await usuario.click(anterior);

    expect(router.state.location.search).toBe('');
    expect(paginas).toEqual([1]);
  });

  it('página além da última volta, sem criar histórico, para a última que existe', async () => {
    simularPreferenciaDoSistema(false);
    const paginas = servir('lances', (pagina) => ({
      itens: pagina > 2 ? [] : [lance(pagina)],
      total: 30,
    }));
    const { router } = abrir('/meus-arremates?pagina=9');

    expect(await screen.findByText('Lote 2')).toBeVisible();
    expect(router.state.location.search).toBe('?pagina=2');
    expect(paginas).toEqual([9, 2]);
  });

  it('cada aba tem o seu estado vazio', async () => {
    simularPreferenciaDoSistema(false);
    servir('lances', () => ({ itens: [], total: 0 }));
    servir('arremates', () => ({ itens: [], total: 0 }));
    const usuario = userEvent.setup();
    abrir();

    expect(await screen.findByText('Você ainda não deu nenhum lance.')).toBeVisible();
    expect(screen.queryByRole('link', { name: /vitrine/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Paginação' })).not.toBeInTheDocument();

    await usuario.click(screen.getByRole('tab', { name: 'Arrematados' }));
    expect(await screen.findByText('Você ainda não arrematou nenhum lote.')).toBeVisible();
    expect(screen.queryByText('Você ainda não deu nenhum lance.')).not.toBeInTheDocument();
  });

  it('o carregando de cada aba tem o seu texto, com role="status"', async () => {
    simularPreferenciaDoSistema(false);
    let liberar: () => void = () => undefined;
    const portao = new Promise<void>((resolver) => (liberar = resolver));
    servir('lances', async () => {
      await portao;
      return { itens: [lance(1)], total: 1 };
    });
    servir('arremates', async () => {
      await portao;
      return { itens: [arremate(1)], total: 1 };
    });
    const usuario = userEvent.setup();
    abrir();

    expect(await screen.findByText('Carregando seus lances…')).toHaveAttribute('role', 'status');
    await usuario.click(screen.getByRole('tab', { name: 'Arrematados' }));
    expect(await screen.findByText('Carregando seus arremates…')).toHaveAttribute('role', 'status');
    liberar();
    expect(await screen.findByText('Carta 1')).toBeVisible();
  });

  it('a paginação é um <nav> com o nome "Paginação"', async () => {
    simularPreferenciaDoSistema(false);
    servir('lances', () => ({ itens: [lance(1)], total: 30 }));
    abrir();

    const navegacao = await screen.findByRole('navigation', { name: 'Paginação' });
    expect(within(navegacao).getByText('Página 1 de 2')).toBeVisible();
  });

  it('falha mostra o erro e "Tentar de novo" busca outra vez', async () => {
    simularPreferenciaDoSistema(false);
    let chamadas = 0;
    servidor.use(
      http.get(`${ORIGEM}/api/me/lances`, () => {
        chamadas += 1;
        if (chamadas === 1) return HttpResponse.error();
        return HttpResponse.json({
          sucesso: true,
          dados: [lance(1)],
          meta: { total: 1, pagina: 1, limite: 24 },
        });
      }),
    );
    const usuario = userEvent.setup();
    abrir();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'O serviço está indisponível agora. Tente de novo em instantes.',
    );
    await usuario.click(screen.getByRole('button', { name: 'Tentar de novo' }));

    expect(await screen.findByText('Lote 1')).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(chamadas).toBe(2);
  });

  it('setas do teclado trocam de aba e levam o foco para ela', async () => {
    simularPreferenciaDoSistema(false);
    servir('lances', () => ({ itens: [lance(1)], total: 1 }));
    servir('arremates', () => ({ itens: [arremate(1)], total: 1 }));
    const usuario = userEvent.setup();
    abrir();

    await screen.findByText('Lote 1');
    screen.getByRole('tab', { name: 'Meus lances' }).focus();
    await usuario.keyboard('{ArrowRight}');

    const aba = await screen.findByRole('tab', { name: 'Arrematados', selected: true });
    expect(aba).toHaveFocus();
    expect(await screen.findByText('Carta 1')).toBeVisible();
  });

  it.each(['light', 'dark'] as const)('axe sem violações sérias no tema %s', async (tema) => {
    simularPreferenciaDoSistema(false);
    document.documentElement.dataset['theme'] = tema;
    servir('lances', () => ({
      itens: [
        lance(1, { posicao: 'ganhando' }),
        lance(2, { posicao: 'superado' }),
        lance(3, { posicao: 'venceu' }),
        lance(4, { posicao: 'perdeu' }),
      ],
      total: 30,
    }));
    servir('arremates', () => ({ itens: [arremate(1)], total: 1 }));
    const usuario = userEvent.setup();
    abrir();

    await screen.findByRole('list', { name: 'Meus lances' });
    expect(await violacoesSerias()).toEqual([]);

    await usuario.click(screen.getByRole('tab', { name: 'Arrematados' }));
    await screen.findByRole('list', { name: 'Arrematados' });
    expect(await violacoesSerias()).toEqual([]);
  });
});
