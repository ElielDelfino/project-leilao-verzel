import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { simularPreferenciaDoSistema } from './apoio/matchMedia';
import { renderizarApp } from './apoio/renderizarApp';

// Rotas de specs/012 §Rotas, ainda como páginas provisórias (tarefa 005).
const ROTAS: Array<[string, string]> = [
  ['/', 'Vitrine'],
  ['/lotes/0192f0a0-0000-7000-8000-000000000001', 'Sala do lote'],
  ['/entrar', 'Entrar'],
  ['/cadastro', 'Cadastro'],
  ['/carteira', 'Carteira'],
  ['/meus-arremates', 'Meus arremates'],
  ['/painel', 'Painel do leiloeiro'],
  ['/painel/lotes/novo', 'Novo lote'],
  ['/auditoria/0192f0a0-0000-7000-8000-000000000001', 'Auditoria do lote'],
  ['/comprovantes/ABC123', 'Comprovante'],
];

describe('rotas', () => {
  it.each(ROTAS)('%s mostra a página "%s" com título e <h1>', async (url, titulo) => {
    simularPreferenciaDoSistema(false);
    renderizarApp(url);

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
