import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AlternarTema } from '../../src/tema/AlternarTema';
import { CHAVE_TEMA } from '../../src/tema/tema';
import { simularPreferenciaDoSistema } from '../apoio/matchMedia';

const temaAplicado = () => document.documentElement.dataset['theme'];
const botaoTema = () => screen.getByRole('button', { name: 'Tema escuro' });

describe('AlternarTema', () => {
  it('segue prefers-color-scheme claro quando não há escolha salva', () => {
    simularPreferenciaDoSistema(false);
    render(<AlternarTema />);

    expect(temaAplicado()).toBe('light');
    expect(botaoTema()).toHaveAttribute('aria-pressed', 'false');
  });

  it('segue prefers-color-scheme escuro quando não há escolha salva', () => {
    simularPreferenciaDoSistema(true);
    render(<AlternarTema />);

    expect(temaAplicado()).toBe('dark');
    expect(botaoTema()).toHaveAttribute('aria-pressed', 'true');
  });

  it('alterna o tema e salva a escolha no localStorage', async () => {
    simularPreferenciaDoSistema(false);
    const usuario = userEvent.setup();
    render(<AlternarTema />);

    await usuario.click(botaoTema());
    expect(temaAplicado()).toBe('dark');
    expect(botaoTema()).toHaveAttribute('aria-pressed', 'true');
    expect(window.localStorage.getItem(CHAVE_TEMA)).toBe('dark');

    await usuario.click(botaoTema());
    expect(temaAplicado()).toBe('light');
    expect(window.localStorage.getItem(CHAVE_TEMA)).toBe('light');
  });

  it('a escolha salva persiste numa nova carga e vence a preferência do sistema', () => {
    simularPreferenciaDoSistema(false);
    window.localStorage.setItem(CHAVE_TEMA, 'dark');
    render(<AlternarTema />);

    expect(temaAplicado()).toBe('dark');
  });

  it('ignora valor salvo desconhecido e volta à preferência do sistema', () => {
    simularPreferenciaDoSistema(true);
    window.localStorage.setItem(CHAVE_TEMA, 'roxo');
    render(<AlternarTema />);

    expect(temaAplicado()).toBe('dark');
  });

  it('acompanha a mudança do sistema enquanto não há escolha salva', () => {
    const sistema = simularPreferenciaDoSistema(false);
    render(<AlternarTema />);

    act(() => sistema.definirEscuro(true));
    expect(temaAplicado()).toBe('dark');
  });

  it('depois de escolher, a mudança do sistema não sobrescreve a escolha', async () => {
    const sistema = simularPreferenciaDoSistema(false);
    const usuario = userEvent.setup();
    render(<AlternarTema />);

    await usuario.click(botaoTema());
    act(() => sistema.definirEscuro(false));
    expect(temaAplicado()).toBe('dark');
  });

  it('funciona sem localStorage disponível (ex.: armazenamento bloqueado)', async () => {
    simularPreferenciaDoSistema(false);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('bloqueado', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('bloqueado', 'SecurityError');
    });
    const usuario = userEvent.setup();
    render(<AlternarTema />);

    expect(temaAplicado()).toBe('light');
    await usuario.click(botaoTema());
    expect(temaAplicado()).toBe('dark');
  });
});
