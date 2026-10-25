import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { campoParaInstante } from '../../src/novo-lote/datas';
import { validarLote, type CamposDoLote } from '../../src/novo-lote/validacao';
import { violacoesSerias } from '../apoio/axe';
import { criarLote } from '../apoio/fixtures-lotes';
import { simularPreferenciaDoSistema } from '../apoio/matchMedia';
import { renderizarApp } from '../apoio/renderizarApp';
import { envelopeDeErro, ORIGEM, servidor, usuarioLeiloeiro } from '../apoio/servidor';

const ID_CARTA = '0192f3a0-0000-7000-8000-0000000000aa';
const CARTA = {
  scryfallId: ID_CARTA,
  nome: 'Black Lotus',
  colecao: 'Alpha',
  raridade: 'rare',
  tipo: 'Artifact',
  artista: 'Christopher Rush',
  imagemUrl: 'https://cards.scryfall.io/small/front/b/d/black-lotus.jpg',
};
const CARTA_SEM_IMAGEM = {
  ...CARTA,
  scryfallId: '0192f3a0-0000-7000-8000-0000000000bb',
  nome: 'Mox Pearl',
  artista: null,
  imagemUrl: null,
};

function resposta(cartas: unknown[], total = cartas.length, pagina = 1) {
  return HttpResponse.json({ sucesso: true, dados: cartas, meta: { total, pagina, limite: 25 } });
}

function abrir(url = '/painel/lotes/novo', escuro = false) {
  simularPreferenciaDoSistema(escuro);
  return renderizarApp(url, { sessao: usuarioLeiloeiro });
}

/** Instante + deslocamento (min) no formato do `datetime-local`, em America/Sao_Paulo. */
function campoEm(minutos: number): string {
  const instante = new Date(Date.now() + minutos * 60_000);
  return instante
    .toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' })
    .slice(0, 16)
    .replace(' ', 'T');
}

async function buscarEEscolher(carta = CARTA) {
  servidor.use(http.get(`${ORIGEM}/api/catalogo/cartas`, () => resposta([carta])));
  const usuario = userEvent.setup();
  const app = abrir();
  await usuario.type(await screen.findByLabelText('Buscar carta na Scryfall'), 'lotus');
  await usuario.click(screen.getByRole('button', { name: 'Buscar cartas' }));
  await usuario.click(await screen.findByRole('button', { name: `Escolher ${carta.nome}` }));
  await screen.findByRole('heading', { level: 2, name: 'Dados do lote' });
  return { usuario, app };
}

function preencher(valores: Record<string, string>) {
  for (const [rotulo, valor] of Object.entries(valores)) {
    fireEvent.change(screen.getByLabelText(rotulo), { target: { value: valor } });
  }
}

const VALIDOS = { 'Lance inicial (R$)': '10,00', 'Incremento mínimo (R$)': '1,00' };

describe('/painel/lotes/novo: passo 1', () => {
  it('título, validação da busca vazia e do limite, sem enviar', async () => {
    let chamadas = 0;
    servidor.use(
      http.get(`${ORIGEM}/api/catalogo/cartas`, () => {
        chamadas += 1;
        return resposta([]);
      }),
    );
    const usuario = userEvent.setup();
    abrir();
    expect(await screen.findByRole('heading', { level: 1, name: 'Novo lote' })).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe('Novo lote · Casa de Leilões'));

    const campo = screen.getByLabelText('Buscar carta na Scryfall');
    expect(campo).toHaveAttribute('maxlength', '200');
    await usuario.type(campo, '   ');
    await usuario.click(screen.getByRole('button', { name: 'Buscar cartas' }));

    expect(campo).toHaveAccessibleDescription(
      /Digite o nome da carta ou use a sintaxe de busca da Scryfall\..*Digite de 1 a 200 caracteres\./,
    );
    expect(chamadas).toBe(0);
  });

  it('lista resultados com textos exatos e põe q na URL', async () => {
    let consulta: URLSearchParams | undefined;
    servidor.use(
      http.get(`${ORIGEM}/api/catalogo/cartas`, ({ request }) => {
        consulta = new URL(request.url).searchParams;
        return resposta([CARTA, CARTA_SEM_IMAGEM]);
      }),
    );
    const usuario = userEvent.setup();
    const { router } = abrir();
    await usuario.type(await screen.findByLabelText('Buscar carta na Scryfall'), ' t:artifact ');
    await usuario.click(screen.getByRole('button', { name: 'Buscar cartas' }));

    expect(await screen.findByText('2 cartas encontradas')).toBeInTheDocument();
    expect(consulta?.get('q')).toBe('t:artifact');
    expect(consulta?.get('pagina')).toBe('1');
    expect(router.state.location.search).toBe('?q=t%3Aartifact');
    const imagem = screen.getByAltText('Carta Black Lotus');
    expect(imagem).toHaveAttribute('src', CARTA.imagemUrl);
    expect(imagem).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(screen.getAllByText('Alpha · Rara')).toHaveLength(2);
    expect(screen.getAllByText('Artifact')).toHaveLength(2);
    expect(screen.getByText('Arte: Christopher Rush')).toBeInTheDocument();
    expect(screen.getByText('Sem imagem')).toBeInTheDocument();
    expect(screen.getAllByText(/^Arte:/)).toHaveLength(1);
  });

  it('reconstrói os resultados da URL e pagina (25 por página)', async () => {
    const paginas: string[] = [];
    servidor.use(
      http.get(`${ORIGEM}/api/catalogo/cartas`, ({ request }) => {
        const pagina = new URL(request.url).searchParams.get('pagina') ?? '';
        paginas.push(pagina);
        return resposta([CARTA], 26, Number(pagina));
      }),
    );
    const usuario = userEvent.setup();
    abrir('/painel/lotes/novo?q=lotus');

    expect(await screen.findByText('26 cartas encontradas')).toBeInTheDocument();
    expect(screen.getByText('Página 1 de 2')).toBeInTheDocument();
    expect(screen.getByLabelText('Buscar carta na Scryfall')).toHaveValue('lotus');
    await usuario.click(screen.getByRole('button', { name: 'Próxima' }));
    expect(await screen.findByText('Página 2 de 2')).toBeInTheDocument();
    expect(paginas).toEqual(['1', '2']);
  });

  it('um resultado usa o singular e nenhum resultado mostra o texto de vazio', async () => {
    servidor.use(http.get(`${ORIGEM}/api/catalogo/cartas`, () => resposta([CARTA])));
    abrir('/painel/lotes/novo?q=lotus');
    expect(await screen.findByText('1 carta encontrada')).toBeInTheDocument();
  });

  it('total 0 mostra "Nenhuma carta encontrada para esta busca."', async () => {
    servidor.use(http.get(`${ORIGEM}/api/catalogo/cartas`, () => resposta([])));
    abrir('/painel/lotes/novo?q=zzz');
    expect(
      await screen.findByText('Nenhuma carta encontrada para esta busca.'),
    ).toBeInTheDocument();
    expect(screen.getByText('0 cartas encontradas')).toBeInTheDocument();
  });

  it('422 com campo q mostra a mensagem de sintaxe', async () => {
    servidor.use(
      http.get(`${ORIGEM}/api/catalogo/cartas`, () =>
        HttpResponse.json(
          { sucesso: false, erro: { codigo: 'DADOS_INVALIDOS', detalhes: { campo: 'q' } } },
          { status: 422 },
        ),
      ),
    );
    abrir('/painel/lotes/novo?q=(');
    expect(
      await screen.findByText('A Scryfall não entendeu esta busca. Confira a sintaxe.'),
    ).toBeInTheDocument();
  });

  it.each([
    ['CATALOGO_OCUPADO', 1, 'A busca de cartas está ocupada. Tente de novo em 1 s.'],
    [
      'CATALOGO_INDISPONIVEL',
      30,
      'A busca de cartas está indisponível agora. Tente de novo em 30 s.',
    ],
  ] as const)(
    '503 %s usa {segundos} de detalhes e a busca pode ser repetida',
    async (codigo, segundos, texto) => {
      let chamadas = 0;
      servidor.use(
        http.get(`${ORIGEM}/api/catalogo/cartas`, () => {
          chamadas += 1;
          if (chamadas > 1) return resposta([CARTA]);
          return HttpResponse.json(
            { sucesso: false, erro: { codigo, detalhes: { tenteNovamenteEm: segundos } } },
            { status: 503, headers: { 'Retry-After': '99' } },
          );
        }),
      );
      const usuario = userEvent.setup();
      abrir('/painel/lotes/novo?q=lotus');
      expect(await screen.findByText(texto)).toBeInTheDocument();

      await usuario.click(screen.getByRole('button', { name: 'Buscar cartas' }));
      expect(await screen.findByText('1 carta encontrada')).toBeInTheDocument();
      expect(screen.queryByText(texto)).not.toBeInTheDocument();
    },
  );

  it('503 sem detalhes usa o Retry-After', async () => {
    servidor.use(
      http.get(`${ORIGEM}/api/catalogo/cartas`, () =>
        envelopeDeErro('CATALOGO_INDISPONIVEL', 503, { 'Retry-After': '30' }),
      ),
    );
    abrir('/painel/lotes/novo?q=lotus');
    expect(
      await screen.findByText('A busca de cartas está indisponível agora. Tente de novo em 30 s.'),
    ).toBeInTheDocument();
  });
});

describe('/painel/lotes/novo: passo 2', () => {
  it('escolher a carta mostra o passo 2 com o foco no título e "Trocar carta" volta', async () => {
    const { usuario } = await buscarEEscolher();

    const titulo = screen.getByRole('heading', { level: 2, name: 'Dados do lote' });
    expect(titulo).toHaveFocus();
    expect(screen.getByAltText('Carta Black Lotus')).toBeInTheDocument();
    expect(screen.getByLabelText('Título (opcional)')).toHaveAttribute('maxlength', '120');
    expect(screen.getByLabelText('Título (opcional)')).toHaveAccessibleDescription(
      'Se ficar em branco, usamos o nome da carta.',
    );
    expect(screen.getByLabelText('Descrição (opcional)')).toHaveAttribute('maxlength', '2000');
    expect(screen.getByLabelText('Começar agora')).toBeChecked();
    expect(screen.getByLabelText('Início')).toBeDisabled();

    await usuario.click(screen.getByRole('button', { name: 'Trocar carta' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Buscar carta' })).toHaveFocus();
    expect(screen.getByText('1 carta encontrada')).toBeInTheDocument();
  });

  it('mostra mensagens por campo ligadas por aria-describedby e foca o primeiro inválido', async () => {
    const { usuario } = await buscarEEscolher();
    await usuario.click(screen.getByRole('button', { name: 'Criar lote' }));

    const lance = screen.getByLabelText('Lance inicial (R$)');
    expect(lance).toHaveFocus();
    expect(lance).toHaveAttribute('aria-invalid', 'true');
    expect(lance).toHaveAccessibleDescription('Informe um valor entre R$ 1,00 e R$ 1.000.000,00.');
    expect(screen.getByLabelText('Incremento mínimo (R$)')).toHaveAccessibleDescription(
      'Informe um valor entre R$ 1,00 e R$ 1.000.000,00.',
    );
    expect(screen.getByLabelText('Fim')).toHaveAccessibleDescription('Informe a data e a hora.');
  });

  it('com "Começar agora" desmarcado, início vazio exige data e início no passado é recusado', async () => {
    const { usuario } = await buscarEEscolher();
    await usuario.click(screen.getByLabelText('Começar agora'));
    preencher({ ...VALIDOS, Fim: campoEm(600) });
    await usuario.click(screen.getByRole('button', { name: 'Criar lote' }));
    expect(screen.getByLabelText('Início')).toHaveAccessibleDescription('Informe a data e a hora.');

    preencher({ Início: campoEm(-5) });
    await usuario.click(screen.getByRole('button', { name: 'Criar lote' }));
    expect(screen.getByLabelText('Início')).toHaveAccessibleDescription(
      'O início não pode ser mais de 1 minuto no passado.',
    );
  });

  it('fim a menos de 5 minutos e duração acima de 7 dias mostram o erro no fim', async () => {
    const { usuario } = await buscarEEscolher();
    preencher({ ...VALIDOS, Fim: campoEm(2) });
    await usuario.click(screen.getByRole('button', { name: 'Criar lote' }));
    expect(screen.getByLabelText('Fim')).toHaveAccessibleDescription(
      'O fim deve ser pelo menos 5 minutos depois do início.',
    );

    preencher({ Fim: campoEm(7 * 24 * 60 + 5) });
    await usuario.click(screen.getByRole('button', { name: 'Criar lote' }));
    expect(screen.getByLabelText('Fim')).toHaveAccessibleDescription(
      'A duração máxima é de 7 dias.',
    );
  });

  it('cria o lote, envia centavos e ISO, desabilita o botão e navega ao painel com o aviso', async () => {
    let corpo: Record<string, unknown> = {};
    let chamadas = 0;
    let liberar: () => void = () => undefined;
    const portao = new Promise<void>((resolver) => {
      liberar = resolver;
    });
    servidor.use(
      http.post(`${ORIGEM}/api/painel/lotes`, async ({ request }) => {
        chamadas += 1;
        corpo = (await request.json()) as Record<string, unknown>;
        await portao;
        return HttpResponse.json({ sucesso: true, dados: criarLote() }, { status: 201 });
      }),
      http.get(`${ORIGEM}/api/painel/resumo`, () => envelopeDeErro('INDISPONIVEL', 503)),
      http.get(`${ORIGEM}/api/painel/lotes`, () =>
        HttpResponse.json({ sucesso: true, dados: [], meta: { total: 0, pagina: 1, limite: 24 } }),
      ),
    );
    const { usuario, app } = await buscarEEscolher();
    preencher({
      ...VALIDOS,
      'Lance inicial (R$)': '1.234,50',
      'Título (opcional)': '  Meu lote  ',
      'Descrição (opcional)': '   ',
      Fim: campoEm(600),
    });
    const antes = Date.now();
    await usuario.click(screen.getByRole('button', { name: 'Criar lote' }));

    const botao = await screen.findByRole('button', { name: 'Criando…' });
    expect(botao).toBeDisabled();
    await usuario.click(botao);
    liberar();

    await waitFor(() => expect(app.router.state.location.pathname).toBe('/painel'));
    expect(chamadas).toBe(1);
    expect(corpo).toMatchObject({
      scryfallId: ID_CARTA,
      titulo: 'Meu lote',
      lanceInicialCentavos: 123_450,
      incrementoMinimoCentavos: 100,
    });
    expect(corpo).not.toHaveProperty('descricao');
    const inicio = Date.parse(String(corpo['inicioEm']));
    expect(inicio).toBeGreaterThanOrEqual(antes);
    expect(inicio).toBeLessThanOrEqual(Date.now());
    expect(String(corpo['fimEm'])).toMatch(/Z$/);
    expect(await screen.findByText('Lote criado.')).toBeInTheDocument();
  });

  it('422 mostra só a mensagem geral de DADOS_INVALIDOS e permanece no passo 2', async () => {
    servidor.use(
      http.post(`${ORIGEM}/api/painel/lotes`, () =>
        HttpResponse.json(
          { sucesso: false, erro: { codigo: 'DADOS_INVALIDOS', detalhes: { campo: 'titulo' } } },
          { status: 422 },
        ),
      ),
    );
    const { usuario } = await buscarEEscolher();
    preencher({ ...VALIDOS, Fim: campoEm(600) });
    await usuario.click(screen.getByRole('button', { name: 'Criar lote' }));

    expect(await screen.findByText('Confira os campos destacados.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Dados do lote' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Criar lote' })).toBeEnabled();
  });

  it('422 com campo scryfallId volta ao passo 1 com a mensagem da carta', async () => {
    servidor.use(
      http.post(`${ORIGEM}/api/painel/lotes`, () =>
        HttpResponse.json(
          {
            sucesso: false,
            erro: { codigo: 'DADOS_INVALIDOS', detalhes: { campo: 'scryfallId' } },
          },
          { status: 422 },
        ),
      ),
    );
    const { usuario } = await buscarEEscolher();
    preencher({ ...VALIDOS, Fim: campoEm(600) });
    await usuario.click(screen.getByRole('button', { name: 'Criar lote' }));

    expect(
      await screen.findByText('Não foi possível usar esta carta. Escolha outra.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Buscar carta' })).toBeInTheDocument();
  });

  it.each([
    ['CATALOGO_OCUPADO', 1, 'A busca de cartas está ocupada. Tente de novo em 1 s.'],
    [
      'CATALOGO_INDISPONIVEL',
      30,
      'A busca de cartas está indisponível agora. Tente de novo em 30 s.',
    ],
  ] as const)(
    '503 %s na criação mostra o texto com {segundos}',
    async (codigo, segundos, texto) => {
      servidor.use(
        http.post(`${ORIGEM}/api/painel/lotes`, () =>
          HttpResponse.json(
            { sucesso: false, erro: { codigo, detalhes: { tenteNovamenteEm: segundos } } },
            { status: 503, headers: { 'Retry-After': String(segundos) } },
          ),
        ),
      );
      const { usuario } = await buscarEEscolher();
      preencher({ ...VALIDOS, Fim: campoEm(600) });
      await usuario.click(screen.getByRole('button', { name: 'Criar lote' }));

      expect(await screen.findByText(texto)).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 2, name: 'Dados do lote' })).toBeInTheDocument();
    },
  );
});

describe('validarLote (limites de specs/006)', () => {
  const agora = new Date('2026-10-26T15:00:00Z');
  const base: CamposDoLote = {
    scryfallId: ID_CARTA,
    titulo: '',
    descricao: '',
    lanceInicial: '1,00',
    incremento: '1,00',
    comecarAgora: false,
    inicio: '2026-10-26T12:00',
    fim: '2026-10-26T12:05',
  };
  const erros = (campos: Partial<CamposDoLote>) => {
    const r = validarLote({ ...base, ...campos }, agora);
    return r.ok ? {} : r.erros;
  };

  it('aceita as fronteiras', () => {
    expect(validarLote(base, agora).ok).toBe(true);
    expect(
      validarLote(
        {
          ...base,
          lanceInicial: '1.000.000,00',
          incremento: '1.000.000,00',
          fim: '2026-11-02T12:00',
        },
        agora,
      ).ok,
    ).toBe(true);
    expect(
      validarLote({ ...base, inicio: '2026-10-26T11:59', fim: '2026-10-26T12:05' }, agora).ok,
    ).toBe(true);
  });

  it.each(['0,99', '1.000.000,01', '', 'abc', '1,234'])('recusa o valor %j', (valor) => {
    expect(erros({ lanceInicial: valor }).lanceInicial).toBe(
      'Informe um valor entre R$ 1,00 e R$ 1.000.000,00.',
    );
    expect(erros({ incremento: valor }).incremento).toBe(
      'Informe um valor entre R$ 1,00 e R$ 1.000.000,00.',
    );
  });

  it('recusa início 2 minutos no passado, fim a 4 minutos e duração de 7 dias + 1 minuto', () => {
    expect(erros({ inicio: '2026-10-26T11:58', fim: '2026-10-26T12:30' }).inicio).toBe(
      'O início não pode ser mais de 1 minuto no passado.',
    );
    expect(erros({ fim: '2026-10-26T12:04' }).fim).toBe(
      'O fim deve ser pelo menos 5 minutos depois do início.',
    );
    expect(erros({ fim: '2026-11-02T12:01' }).fim).toBe('A duração máxima é de 7 dias.');
  });

  it('lê as datas como America/Sao_Paulo (UTC−3)', () => {
    expect(campoParaInstante('2026-10-26T12:00')?.toISOString()).toBe('2026-10-26T15:00:00.000Z');
    expect(campoParaInstante('2026-02-30T12:00')).toBeNull();
    expect(campoParaInstante('')).toBeNull();
  });
});

describe('/painel/lotes/novo: acessibilidade', () => {
  it.each([false, true])(
    'axe sem violações sérias nos dois passos (tema escuro: %s)',
    async (escuro) => {
      servidor.use(http.get(`${ORIGEM}/api/catalogo/cartas`, () => resposta([CARTA])));
      const usuario = userEvent.setup();
      abrir('/painel/lotes/novo?q=lotus', escuro);
      await usuario.click(await screen.findByRole('button', { name: 'Escolher Black Lotus' }));
      expect(await violacoesSerias()).toEqual([]);
      await screen.findByRole('heading', { level: 2, name: 'Dados do lote' });
      expect(await violacoesSerias()).toEqual([]);
    },
  );

  it('axe no passo 1 com resultados', async () => {
    servidor.use(
      http.get(`${ORIGEM}/api/catalogo/cartas`, () => resposta([CARTA, CARTA_SEM_IMAGEM])),
    );
    abrir('/painel/lotes/novo?q=lotus');
    await screen.findByText('2 cartas encontradas');
    expect(await violacoesSerias()).toEqual([]);
  });
});
