import { describe, expect, it } from 'vitest';

import { destinoDoPapel, destinoPosLogin, papelPodeAcessar } from '../../src/sessao/destino';

describe('destinoDoPapel', () => {
  it('licitante vai para / e leiloeiro para /painel', () => {
    expect(destinoDoPapel('licitante')).toBe('/');
    expect(destinoDoPapel('leiloeiro')).toBe('/painel');
  });
});

describe('papelPodeAcessar', () => {
  it.each([
    ['licitante', '/carteira', true],
    ['licitante', '/meus-arremates', true],
    ['licitante', '/painel', false],
    ['licitante', '/painel/lotes/novo', false],
    ['leiloeiro', '/painel', true],
    ['leiloeiro', '/painel/lotes/novo', true],
    ['leiloeiro', '/carteira', false],
    ['leiloeiro', '/meus-arremates', false],
    ['licitante', '/lotes/abc', true],
    ['leiloeiro', '/lotes/abc', true],
    ['licitante', '/', true],
  ] as const)('%s em %s → %s', (papel, caminho, esperado) => {
    expect(papelPodeAcessar(papel, caminho)).toBe(esperado);
  });
});

describe('destinoPosLogin', () => {
  it('usa o retorno interno permitido ao papel, com query string', () => {
    expect(destinoPosLogin('/carteira?pagina=2', 'licitante')).toBe('/carteira?pagina=2');
    expect(destinoPosLogin('/painel', 'leiloeiro')).toBe('/painel');
  });

  it.each([
    ['//exemplo.com', 'licitante', '/'],
    ['//exemplo.com', 'leiloeiro', '/painel'],
    ['/\\exemplo.com', 'licitante', '/'],
    ['/carteira\\x', 'licitante', '/'],
    ['/.//evil.com', 'licitante', '/'],
    ['/a/..//evil.com', 'licitante', '/'],
    ['/%2e//evil.com', 'licitante', '/'],
    ['%2F%2Fevil.com', 'licitante', '/'],
    ['%5Cevil.com', 'licitante', '/'],
    ['https://exemplo.com', 'licitante', '/'],
    ['javascript:alert(1)', 'licitante', '/'],
    ['carteira', 'licitante', '/'],
    ['', 'licitante', '/'],
    ['/painel', 'licitante', '/'],
    ['/carteira', 'leiloeiro', '/painel'],
    ['/entrar', 'licitante', '/'],
    ['/cadastro?retorno=/x', 'leiloeiro', '/painel'],
  ] as const)('ignora o retorno %j para %s', (retorno, papel, esperado) => {
    expect(destinoPosLogin(retorno, papel)).toBe(esperado);
  });

  it('sem retorno cai no destino do papel', () => {
    expect(destinoPosLogin(null, 'licitante')).toBe('/');
    expect(destinoPosLogin(null, 'leiloeiro')).toBe('/painel');
  });
});
