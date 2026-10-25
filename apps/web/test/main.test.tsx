import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { simularPreferenciaDoSistema } from './apoio/matchMedia';

// main.tsx não exporta a raiz; este repasse guarda as raízes criadas para desmontá-las no fim.
const raizesCriadas = vi.hoisted((): Root[] => []);

vi.mock('react-dom/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('react-dom/client')>();
  return {
    ...original,
    createRoot: (...args: Parameters<typeof original.createRoot>) => {
      const raiz = original.createRoot(...args);
      raizesCriadas.push(raiz);
      return raiz;
    },
  };
});

function criarElementoRaiz(): HTMLDivElement {
  const raiz = document.createElement('div');
  raiz.id = 'root';
  document.body.append(raiz);
  return raiz;
}

// Árvore de produção (com o <StrictMode> de main.tsx) e roteador do navegador.
describe('main.tsx', () => {
  afterEach(() => {
    act(() => raizesCriadas.splice(0).forEach((raiz) => raiz.unmount()));
    document.getElementById('root')?.remove();
    window.history.replaceState(null, '', '/');
    vi.resetModules();
  });

  it('monta a SPA no #root com o roteador do navegador, sem roubar o foco', async () => {
    simularPreferenciaDoSistema(true);
    criarElementoRaiz();

    await act(() => import('../src/main'));

    expect(await screen.findByRole('heading', { level: 1, name: 'Vitrine' })).toBeInTheDocument();
    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(document.activeElement).toBe(document.body);
  });

  it('sob StrictMode, trocar de pathname foca o <main> e o tema alterna uma vez por clique', async () => {
    simularPreferenciaDoSistema(false);
    window.history.replaceState(null, '', '/carteira');
    criarElementoRaiz();
    const usuario = userEvent.setup();

    await act(() => import('../src/main'));
    await screen.findByRole('heading', { level: 1, name: 'Carteira' });
    expect(document.activeElement).toBe(document.body);

    await usuario.click(screen.getByRole('link', { name: 'Casa de Leilões' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Vitrine' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveFocus();

    await usuario.click(screen.getByRole('button', { name: 'Tema escuro' }));
    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(screen.getByRole('button', { name: 'Tema escuro' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});
