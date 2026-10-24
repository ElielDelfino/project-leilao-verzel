import { describe, expect, it } from 'vitest';

// Script clássico em public/: roda no <head> antes da primeira pintura para evitar o "flash"
// do tema errado. Lido como texto para executar exatamente o que o navegador recebe.
import scriptTemaInicial from '../../public/tema-inicial.js?raw';
import { CHAVE_TEMA } from '../../src/tema/tema';
import { simularPreferenciaDoSistema } from '../apoio/matchMedia';

function executarScript(): void {
  new Function(scriptTemaInicial)();
}

const temaAplicado = () => document.documentElement.dataset['theme'];

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
});
