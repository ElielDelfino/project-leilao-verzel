import { describe, expect, it, vi } from 'vitest';

// Script clássico em public/: roda no <head> antes da primeira pintura para evitar o "flash"
// do tema errado. Lido como texto para executar exatamente o que o navegador recebe.
import scriptTemaInicial from '../../public/tema-inicial.js?raw';
import { CHAVE_TEMA, lerTemaSalvo, temaDoSistema } from '../../src/tema/tema';
import { simularPreferenciaDoSistema } from '../apoio/matchMedia';

function executarScript(): void {
  new Function(scriptTemaInicial)();
}

const temaAplicado = () => document.documentElement.dataset['theme'];

/** O que o app (src/tema/tema.ts) decide nas mesmas condições: escolha salva ou sistema. */
const temaDoApp = () => lerTemaSalvo() ?? temaDoSistema();

function bloquearLocalStorage(): void {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new DOMException('bloqueado', 'SecurityError');
  });
}

describe('public/tema-inicial.js', () => {
  it('aplica o tema do sistema quando não há escolha salva', () => {
    simularPreferenciaDoSistema(true);
    executarScript();
    expect(temaAplicado()).toBe('dark');
  });

  it('aplica a escolha salva com a mesma chave do app', () => {
    simularPreferenciaDoSistema(true);
    window.localStorage.setItem(CHAVE_TEMA, 'light');
    executarScript();
    expect(temaAplicado()).toBe('light');
  });

  it('ignora valor salvo desconhecido', () => {
    simularPreferenciaDoSistema(false);
    window.localStorage.setItem(CHAVE_TEMA, 'roxo');
    executarScript();
    expect(temaAplicado()).toBe('light');
  });

  it('com o localStorage lançando exceção, segue o sistema sem quebrar', () => {
    simularPreferenciaDoSistema(true);
    bloquearLocalStorage();
    expect(executarScript).not.toThrow();
    expect(temaAplicado()).toBe('dark');
  });

  it('sem matchMedia no navegador, cai no tema claro', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(executarScript).not.toThrow();
    expect(temaAplicado()).toBe('light');
  });
});

describe('paridade entre public/tema-inicial.js e src/tema/tema.ts', () => {
  const casos: Array<[string, () => void]> = [
    ['sistema escuro, nada salvo', () => simularPreferenciaDoSistema(true)],
    ['sistema claro, nada salvo', () => simularPreferenciaDoSistema(false)],
    [
      'escolha salva vence o sistema',
      () => {
        simularPreferenciaDoSistema(false);
        window.localStorage.setItem(CHAVE_TEMA, 'dark');
      },
    ],
    [
      'valor salvo desconhecido',
      () => {
        simularPreferenciaDoSistema(true);
        window.localStorage.setItem(CHAVE_TEMA, 'roxo');
      },
    ],
    [
      'localStorage lançando exceção',
      () => {
        simularPreferenciaDoSistema(true);
        bloquearLocalStorage();
      },
    ],
    ['matchMedia ausente', () => vi.stubGlobal('matchMedia', undefined)],
  ];

  it.each(casos)('%s: o script e o app escolhem o mesmo tema', (_caso, preparar) => {
    preparar();
    executarScript();
    expect(temaAplicado()).toBe(temaDoApp());
  });
});
