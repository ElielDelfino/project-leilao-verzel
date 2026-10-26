import { screen, waitFor, within } from '@testing-library/react';
import { http } from 'msw';
import { describe, expect, it } from 'vitest';

import { simularPreferenciaDoSistema } from './apoio/matchMedia';
import { renderizarApp } from './apoio/renderizarApp';
import {
  envelopeDeErro,
  ORIGEM,
  servidor,
  usuarioLeiloeiro,
  usuarioLicitante,
} from './apoio/servidor';

// Rotas de specs/012 §Rotas ainda como páginas provisórias (tarefa 005). A vitrine e o detalhe
// do lote consultam a API e têm os próprios testes (test/paginas/vitrine.test.tsx e lote.test.tsx).
type Usuario = typeof usuarioLicitante | typeof usuarioLeiloeiro | null;
const ROTAS: Array<[string, string, Usuario]> = [
  ['/entrar', 'Entrar', null],
  ['/cadastro', 'Cadastro', null],
  ['/carteira', 'Carteira', usuarioLicitante],
  ['/meus-arremates', 'Meus arremates', usuarioLicitante],
  ['/painel', 'Painel do leiloeiro', usuarioLeiloeiro],
  ['/painel/lotes/novo', 'Novo lote', usuarioLeiloeiro],
  ['/auditoria/0192f0a0-0000-7000-8000-000000000001', 'Auditoria do lote', null],
];

describe('rotas', () => {
  it.each(ROTAS)('%s mostra a página "%s" com título e <h1>', async (url, titulo, sessao) => {
    simularPreferenciaDoSistema(false);
    renderizarApp(url, { sessao });

    expect(await screen.findByRole('heading', { level: 1, name: titulo })).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe(`${titulo} · Casa de Leilões`));
  });

  it('/comprovantes/:codigo consulta a API e mostra título e <h1> do comprovante', async () => {
    servidor.use(
      http.get(`${ORIGEM}/api/comprovantes/:codigo`, () => envelopeDeErro('NAO_ENCONTRADO', 404)),
    );
    simularPreferenciaDoSistema(false);
    renderizarApp('/comprovantes/ABC123');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Comprovante não encontrado' }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(document.title).toBe('Comprovante não encontrado · Casa de Leilões'),
    );
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
