import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { simularPreferenciaDoSistema } from './apoio/matchMedia';
import { renderizarApp } from './apoio/renderizarApp';
import { usuarioLeiloeiro, usuarioLicitante } from './apoio/servidor';

// Rotas de specs/012 §Rotas, ainda como páginas provisórias (tarefa 005).
type Usuario = typeof usuarioLicitante | typeof usuarioLeiloeiro | null;
const ROTAS: Array<[string, string, Usuario]> = [
  ['/', 'Vitrine', null],
  ['/lotes/0192f0a0-0000-7000-8000-000000000001', 'Sala do lote', null],
  ['/entrar', 'Entrar', null],
  ['/cadastro', 'Cadastro', null],
  ['/carteira', 'Carteira', usuarioLicitante],
  ['/meus-arremates', 'Meus arremates', usuarioLicitante],
  ['/painel', 'Painel do leiloeiro', usuarioLeiloeiro],
  ['/painel/lotes/novo', 'Novo lote', usuarioLeiloeiro],
  ['/auditoria/0192f0a0-0000-7000-8000-000000000001', 'Auditoria do lote', null],
  ['/comprovantes/ABC123', 'Comprovante', null],
];

describe('rotas', () => {
  it.each(ROTAS)('%s mostra a página "%s" com título e <h1>', async (url, titulo, sessao) => {
    simularPreferenciaDoSistema(false);
    renderizarApp(url, { sessao });

    expect(await screen.findByRole('heading', { level: 1, name: titulo })).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe(`${titulo} · Casa de Leilões`));
  });

  it('URL desconhecida mostra "Página não encontrada" dentro do layout', async () => {
    simularPreferenciaDoSistema(false);
    renderizarApp('/nao-existe');

    const titulo = await screen.findByRole('heading', { level: 1, name: 'Página não encontrada' });
    const conteudo = screen.getByRole('main');
    expect(conteudo).toContainElement(titulo);
    expect(within(conteudo).getByRole('link', { name: 'Voltar à vitrine' })).toHaveAttribute(
      'href',
      '/',
    );
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe('Página não encontrada · Casa de Leilões'));
  });

  it('URL desconhecida não redireciona', async () => {
    simularPreferenciaDoSistema(false);
    const { router } = renderizarApp('/nao-existe');

    await screen.findByRole('heading', { level: 1, name: 'Página não encontrada' });
    expect(router.state.location.pathname).toBe('/nao-existe');
  });
});
