import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { simularPreferenciaDoSistema } from '../apoio/matchMedia';
import { renderizarApp } from '../apoio/renderizarApp';
import { violacoesSerias } from '../apoio/axe';

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

  it('o rodapé traz o aviso da Fan Content Policy e o crédito à Scryfall', async () => {
    simularPreferenciaDoSistema(false);
    renderizarApp('/');

    const rodape = await screen.findByRole('contentinfo');
    expect(rodape).toHaveTextContent(/Conteúdo de Fã não oficial/);
    expect(rodape).toHaveTextContent(/Não é aprovada nem endossada pela Wizards/);
    expect(rodape).toHaveTextContent(/© Wizards of the Coast LLC/);
    expect(
      within(rodape).getByRole('link', { name: 'Política de Conteúdo de Fãs' }),
    ).toHaveAttribute('href', 'https://company.wizards.com/en/legal/fancontentpolicy');
    expect(within(rodape).getByRole('link', { name: 'Scryfall' })).toHaveAttribute(
      'href',
      'https://scryfall.com',
    );
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
