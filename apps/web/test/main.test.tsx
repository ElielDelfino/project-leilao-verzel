import { act, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { simularPreferenciaDoSistema } from './apoio/matchMedia';

describe('main.tsx', () => {
  it('monta a SPA no #root com o roteador do navegador', async () => {
    simularPreferenciaDoSistema(false);
    const raiz = document.createElement('div');
    raiz.id = 'root';
    document.body.append(raiz);

    await act(() => import('../src/main'));

    expect(await screen.findByRole('heading', { level: 1, name: 'Vitrine' })).toBeInTheDocument();
    raiz.remove();
  });
});
