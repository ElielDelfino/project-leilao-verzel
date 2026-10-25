import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { simularPreferenciaDoSistema } from '../apoio/matchMedia';
import { renderizarApp } from '../apoio/renderizarApp';
import { violacoesSerias } from '../apoio/axe';

// Textos fixos de specs/012 §Rodapé (item 1: texto oficial pt-BR da Fan Content Policy).
const TEXTO_FAN_CONTENT_POLICY =
  'Casa de Leilões é um conteúdo de fã não oficial permitido sob a política de conteúdo de fãs. ' +
  'Não aprovado/apoiado pela Wizards. Porções do material usado são propriedade da Wizards of ' +
  'the Coast. ©Wizards of the Coast LLC.';
const TEXTO_CREDITO_SCRYFALL = 'Dados e imagens das cartas: Scryfall.';

const textoNormalizado = (elemento: Element) =>
  (elemento.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('LayoutBase', () => {
  it('tem os landmarks banner, main e contentinfo', async () => {
    simularPreferenciaDoSistema(false);
    renderizarApp('/');

    expect(await screen.findByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
  });

  it('o link "Pular para o conteúdo" é o primeiro foco e aponta para o <main>', async () => {
    simularPreferenciaDoSistema(false);
    const usuario = userEvent.setup();
    renderizarApp('/');
    await screen.findByRole('main');

    await usuario.tab();
    const pular = screen.getByRole('link', { name: 'Pular para o conteúdo' });
    expect(pular).toHaveFocus();

    const alvo = pular.getAttribute('href')?.slice(1) ?? '';
    expect(screen.getByRole('main')).toHaveAttribute('id', alvo);
  });

  it('o cabeçalho leva à vitrine e tem a alternância de tema', async () => {
    simularPreferenciaDoSistema(false);
    renderizarApp('/carteira');

    const cabecalho = await screen.findByRole('banner');
    expect(within(cabecalho).getByRole('link', { name: 'Casa de Leilões' })).toHaveAttribute(
      'href',
      '/',
    );
    expect(within(cabecalho).getByRole('button', { name: 'Tema escuro' })).toBeInTheDocument();
  });

  it('o rodapé tem exatamente os dois textos de specs/012 §Rodapé', async () => {
    simularPreferenciaDoSistema(false);
    renderizarApp('/');

    const rodape = await screen.findByRole('contentinfo');
    const paragrafos = [...rodape.querySelectorAll('p')].map(textoNormalizado);
    expect(paragrafos).toEqual([TEXTO_FAN_CONTENT_POLICY, TEXTO_CREDITO_SCRYFALL]);
  });

  it('o rodapé liga a política (página pt-BR) e a Scryfall, e só elas', async () => {
    simularPreferenciaDoSistema(false);
    renderizarApp('/');

    const rodape = await screen.findByRole('contentinfo');
    expect(
      within(rodape).getByRole('link', { name: 'política de conteúdo de fãs' }),
    ).toHaveAttribute('href', 'https://company.wizards.com/pt-br/legal/fancontentpolicy');
    expect(within(rodape).getByRole('link', { name: 'Scryfall' })).toHaveAttribute(
      'href',
      'https://scryfall.com',
    );
    expect(within(rodape).getAllByRole('link')).toHaveLength(2);
    // Sem logo da Scryfall (specs/012 §Rodapé, specs/005).
    expect(within(rodape).queryByRole('img')).not.toBeInTheDocument();
  });

  it('ao navegar para outra rota, o foco vai para o <main>', async () => {
    simularPreferenciaDoSistema(false);
    const { router } = renderizarApp('/');
    await screen.findByRole('main');

    await act(() => router.navigate('/carteira'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Carteira' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveFocus();
  });

  it('na primeira carga o foco não é roubado do documento', async () => {
    simularPreferenciaDoSistema(false);
    renderizarApp('/');
    await screen.findByRole('main');

    expect(screen.getByRole('main')).not.toHaveFocus();
    expect(document.activeElement).toBe(document.body);
  });

  it.each([
    ['a query string', '/?aba=agendados'],
    ['o hash', '/#conteudo'],
  ])('navegar mudando só %s não move o foco', async (_parte, destino) => {
    simularPreferenciaDoSistema(false);
    const { router } = renderizarApp('/');
    await screen.findByRole('main');

    await act(() => router.navigate(destino));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(screen.getByRole('main')).not.toHaveFocus();
    expect(document.activeElement).toBe(document.body);
  });

  it('depois de uma troca de pathname, mudar só a query string mantém o foco onde está', async () => {
    simularPreferenciaDoSistema(false);
    const { router } = renderizarApp('/');
    await screen.findByRole('main');
    await act(() => router.navigate('/carteira'));
    await screen.findByRole('heading', { level: 1, name: 'Carteira' });

    const botaoTema = screen.getByRole('button', { name: 'Tema escuro' });
    act(() => botaoTema.focus());
    await act(() => router.navigate('/carteira?pagina=2'));

    expect(router.state.location.search).toBe('?pagina=2');
    expect(botaoTema).toHaveFocus();
    expect(screen.getByRole('main')).not.toHaveFocus();
  });

  it.each([
    ['claro', false],
    ['escuro', true],
  ])('a página inicial não tem violações sérias do axe no tema %s', async (_nome, escuro) => {
    simularPreferenciaDoSistema(escuro);
    renderizarApp('/');
    await screen.findByRole('heading', { level: 1, name: 'Vitrine' });

    expect(document.documentElement.dataset['theme']).toBe(escuro ? 'dark' : 'light');
    expect(await violacoesSerias()).toEqual([]);
  });
});
