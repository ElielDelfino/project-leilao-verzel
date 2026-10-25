import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CHAVE_TEMA } from '../../src/tema/tema';
import { useTema } from '../../src/tema/useTema';
import { simularPreferenciaDoSistema } from '../apoio/matchMedia';

describe('useTema', () => {
  it('duas alternâncias no mesmo lote de atualizações voltam ao tema inicial', () => {
    simularPreferenciaDoSistema(false);
    const { result } = renderHook(() => useTema());

    act(() => {
      result.current.alternar();
      result.current.alternar();
    });

    expect(result.current.tema).toBe('light');
    expect(document.documentElement.dataset['theme']).toBe('light');
    expect(window.localStorage.getItem(CHAVE_TEMA)).toBe('light');
  });

  it('a escolha salva é a do último estado, não a de um render antigo', () => {
    simularPreferenciaDoSistema(false);
    const { result } = renderHook(() => useTema());
    const alternarDoPrimeiroRender = result.current.alternar;

    act(() => result.current.alternar());
    act(() => alternarDoPrimeiroRender());

    expect(result.current.tema).toBe('light');
    expect(window.localStorage.getItem(CHAVE_TEMA)).toBe('light');
  });

  it('sem escolha do usuário, não grava nada no localStorage', () => {
    simularPreferenciaDoSistema(true);
    const { result } = renderHook(() => useTema());

    expect(result.current.tema).toBe('dark');
    expect(window.localStorage.getItem(CHAVE_TEMA)).toBeNull();
  });
});
