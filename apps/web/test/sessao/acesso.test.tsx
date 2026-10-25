import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import type { SchemasApi } from '@leilao/contracts';

import { simularPreferenciaDoSistema } from '../apoio/matchMedia';
import { renderizarApp } from '../apoio/renderizarApp';
import {
  definirCookie,
  envelopeDeErro,
  ORIGEM,
  servidor,
  usuarioLeiloeiro,
  usuarioLicitante,
} from '../apoio/servidor';

const saldo = {
  totalCentavos: 0,
  comprometidoCentavos: 0,
  disponivelCentavos: 0,
} satisfies SchemasApi['Saldo'];

const handlersDaCarteira = [
  http.get(`${ORIGEM}/api/carteira`, () => HttpResponse.json({ sucesso: true, dados: saldo })),
  http.get(`${ORIGEM}/api/carteira/extrato`, () =>
    HttpResponse.json({
      sucesso: true,
      dados: [],
      meta: { total: 0, pagina: 1, limite: 20 },
    }),
  ),
];

describe('acesso por rota (D11)', () => {
  it('anônimo em rota restrita vai a /entrar?retorno=', async () => {
    simularPreferenciaDoSistema(false);
    const { router } = renderizarApp('/carteira?pagina=2');

    await screen.findByRole('heading', { level: 1, name: 'Entrar' });
    expect(router.state.location.pathname).toBe('/entrar');
    expect(router.state.location.search).toBe(
      `?retorno=${encodeURIComponent('/carteira?pagina=2')}`,
    );
  });

  it('na carga inicial anônima não aparece mensagem alguma', async () => {
    simularPreferenciaDoSistema(false);
    renderizarApp('/entrar');

    await screen.findByRole('heading', { level: 1, name: 'Entrar' });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it.each([
    ['/painel', usuarioLicitante],
    ['/painel/lotes/novo', usuarioLicitante],
    ['/carteira', usuarioLeiloeiro],
    ['/meus-arremates', usuarioLeiloeiro],
  ])('papel errado em %s vê "Acesso não permitido" no layout', async (url, sessao) => {
    simularPreferenciaDoSistema(false);
    const { router } = renderizarApp(url, { sessao });

    const titulo = await screen.findByRole('heading', { level: 1, name: 'Acesso não permitido' });
    const conteudo = screen.getByRole('main');
    expect(conteudo).toContainElement(titulo);
    expect(within(conteudo).getByText('Sua conta não tem permissão para esta ação.')).toBeVisible();
    expect(within(conteudo).getByRole('link', { name: 'Voltar à vitrine' })).toHaveAttribute(
      'href',
      '/',
    );
    expect(router.state.location.pathname).toBe(url);
    expect(screen.getByRole('banner')).toBeInTheDocument();
  });

  it.each([
    ['/entrar', usuarioLicitante, '/'],
    ['/cadastro', usuarioLicitante, '/'],
    ['/entrar', usuarioLeiloeiro, '/painel'],
    ['/cadastro', usuarioLeiloeiro, '/painel'],
  ])('logado em %s vai ao destino padrão do papel', async (url, sessao, destino) => {
    simularPreferenciaDoSistema(false);
    const { router } = renderizarApp(url, { sessao });

    await waitFor(() => expect(router.state.location.pathname).toBe(destino));
  });

  it('respeita o retorno interno permitido ao papel', async () => {
    simularPreferenciaDoSistema(false);
    servidor.use(...handlersDaCarteira);
    const { router } = renderizarApp(`/entrar?retorno=${encodeURIComponent('/carteira')}`, {
      sessao: usuarioLicitante,
    });

    await waitFor(() => expect(router.state.location.pathname).toBe('/carteira'));
  });

  it.each([
    ['//exemplo.com', '/'],
    ['https://exemplo.com', '/'],
    ['/painel', '/'],
  ])('ignora o retorno %s e vai para %s', async (retorno, destino) => {
    simularPreferenciaDoSistema(false);
    const { router } = renderizarApp(`/entrar?retorno=${encodeURIComponent(retorno)}`, {
      sessao: usuarioLicitante,
    });

    await waitFor(() => expect(router.state.location.pathname).toBe(destino));
    expect(router.state.location.search).toBe('');
  });
});

describe('cabeçalho por papel (D11)', () => {
  it('anônimo vê Entrar e Criar conta', async () => {
    simularPreferenciaDoSistema(false);
    renderizarApp('/');
    const cabecalho = await screen.findByRole('banner');

    expect(await within(cabecalho).findByRole('link', { name: 'Entrar' })).toHaveAttribute(
      'href',
      '/entrar',
    );
    expect(within(cabecalho).getByRole('link', { name: 'Criar conta' })).toHaveAttribute(
      'href',
      '/cadastro',
    );
    expect(within(cabecalho).queryByRole('button', { name: 'Sair' })).not.toBeInTheDocument();
  });

  it('licitante vê Carteira, Meus arremates, o nome e Sair', async () => {
    simularPreferenciaDoSistema(false);
    renderizarApp('/', { sessao: usuarioLicitante });
    const cabecalho = await screen.findByRole('banner');

    expect(await within(cabecalho).findByRole('link', { name: 'Carteira' })).toBeVisible();
    expect(within(cabecalho).getByRole('link', { name: 'Meus arremates' })).toBeVisible();
    expect(within(cabecalho).getByText(usuarioLicitante.nome)).toBeVisible();
    expect(within(cabecalho).getByRole('button', { name: 'Sair' })).toBeVisible();
    expect(within(cabecalho).queryByRole('link', { name: 'Painel' })).not.toBeInTheDocument();
  });

  it('leiloeiro vê Painel, o nome e Sair', async () => {
    simularPreferenciaDoSistema(false);
    renderizarApp('/', { sessao: usuarioLeiloeiro });
    const cabecalho = await screen.findByRole('banner');

    expect(await within(cabecalho).findByRole('link', { name: 'Painel' })).toBeVisible();
    expect(within(cabecalho).getByText(usuarioLeiloeiro.nome)).toBeVisible();
    expect(within(cabecalho).queryByRole('link', { name: 'Carteira' })).not.toBeInTheDocument();
  });

  it('Sair encerra a sessão (POST /logout com CSRF) e volta à vitrine como anônimo', async () => {
    simularPreferenciaDoSistema(false);
    definirCookie('csrf_token', 'abc');
    let csrf: string | null = null;
    servidor.use(
      http.post(`${ORIGEM}/api/auth/logout`, ({ request }) => {
        csrf = request.headers.get('X-CSRF-Token');
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const usuario = userEvent.setup();
    const { router } = renderizarApp('/', { sessao: usuarioLicitante });

    await usuario.click(await screen.findByRole('button', { name: 'Sair' }));

    expect(await screen.findByRole('link', { name: 'Entrar' })).toBeVisible();
    expect(csrf).toBe('abc');
    expect(router.state.location.pathname).toBe('/');
  });
});

describe('sessão expirada durante o uso (D11)', () => {
  it('refresh 401 → /entrar?retorno=... com "Sua sessão expirou. Entre novamente."', async () => {
    simularPreferenciaDoSistema(false);
    definirCookie('csrf_token', 'abc');
    servidor.use(
      http.get(`${ORIGEM}/api/carteira`, () => envelopeDeErro('NAO_AUTENTICADO', 401)),
      http.get(`${ORIGEM}/api/carteira/extrato`, () => envelopeDeErro('NAO_AUTENTICADO', 401)),
    );
    const { router } = renderizarApp('/carteira', { sessao: usuarioLicitante });

    expect(await screen.findByText('Sua sessão expirou. Entre novamente.')).toBeVisible();
    await act(async () => undefined);
    expect(router.state.location.pathname).toBe('/entrar');
    expect(router.state.location.search).toBe(`?retorno=${encodeURIComponent('/carteira')}`);
  });

  it('repetição após refresh bem-sucedido que volta 401 → /entrar?retorno=... com "Entre para continuar."', async () => {
    simularPreferenciaDoSistema(false);
    definirCookie('csrf_token', 'abc');
    servidor.use(
      http.post(`${ORIGEM}/api/auth/refresh`, () => new HttpResponse(null, { status: 204 })),
      http.get(`${ORIGEM}/api/carteira`, () => envelopeDeErro('NAO_AUTENTICADO', 401)),
      http.get(`${ORIGEM}/api/carteira/extrato`, () => envelopeDeErro('NAO_AUTENTICADO', 401)),
    );
    const { router } = renderizarApp('/carteira', { sessao: usuarioLicitante });

    expect(await screen.findByText('Entre para continuar.')).toBeVisible();
    expect(router.state.location.pathname).toBe('/entrar');
    expect(router.state.location.search).toBe(`?retorno=${encodeURIComponent('/carteira')}`);
  });
});
