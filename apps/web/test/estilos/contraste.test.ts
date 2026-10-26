import { describe, expect, it } from 'vitest';

import tokensCss from '../../src/estilos/tokens.css?raw';

// O axe no jsdom não calcula contraste (não há motor de CSS). Este teste garante o contraste
// WCAG 2.2 AA dos pares de tokens nos dois temas (specs/012 §Comportamento, Acessibilidade);
// o axe com Playwright nas rotas fica na suíte e2e.

type Cores = Record<string, string>;

// O Prettier pode trocar aspas duplas por simples no seletor; compara sem depender disso.
const css = tokensCss.replaceAll("'", '"');

function lerBloco(seletor: string): Cores {
  const inicio = css.indexOf(`${seletor} {`);
  if (inicio < 0) throw new Error(`Bloco ${seletor} não encontrado em tokens.css`);
  const fim = css.indexOf('}', inicio);
  const corpo = css.slice(inicio, fim);
  const cores: Cores = {};
  for (const [, nome, hex] of corpo.matchAll(/--(cor-[a-z-]+):\s*(#[0-9a-fA-F]{6});/g)) {
    if (nome && hex) cores[nome] = hex;
  }
  return cores;
}

function luminancia(hex: string): number {
  const canais = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r = 0, g = 0, b = 0] = canais.map((c) =>
    c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contraste(a: string, b: string): number {
  const [maior, menor] = [luminancia(a), luminancia(b)].sort((x, y) => y - x) as [number, number];
  return (maior + 0.05) / (menor + 0.05);
}

const TEXTO_AA = 4.5;
const NAO_TEXTO_AA = 3; // SC 1.4.11: indicador de foco e componentes de interface

// [primeiro plano, fundo, mínimo]
const PARES: Array<[string, string, number]> = [
  ['cor-texto', 'cor-fundo', TEXTO_AA],
  ['cor-texto', 'cor-superficie', TEXTO_AA],
  ['cor-texto-suave', 'cor-fundo', TEXTO_AA],
  ['cor-texto-suave', 'cor-superficie', TEXTO_AA],
  ['cor-link', 'cor-fundo', TEXTO_AA],
  ['cor-link', 'cor-superficie', TEXTO_AA],
  ['cor-texto-sobre-primario', 'cor-primario', TEXTO_AA],
  ['cor-foco', 'cor-fundo', NAO_TEXTO_AA],
  ['cor-foco', 'cor-superficie', NAO_TEXTO_AA],
  ['cor-borda-controle', 'cor-superficie', NAO_TEXTO_AA],
  ['cor-borda-controle', 'cor-fundo', NAO_TEXTO_AA],
  // Telas da F4 (auditoria, comprovante, meus arremates, diálogo): botões primários e os
  // indicadores com borda primária precisam de 3:1 contra o fundo e a superfície (SC 1.4.11).
  ['cor-primario', 'cor-fundo', NAO_TEXTO_AA],
  ['cor-primario', 'cor-superficie', NAO_TEXTO_AA],
  // Selo e veredito usam border-current: a borda herda cor-texto e cor-texto-suave.
  ['cor-texto', 'cor-fundo', NAO_TEXTO_AA],
  ['cor-texto-suave', 'cor-superficie', NAO_TEXTO_AA],
];

const TEMAS: Array<[string, Cores]> = [
  ['claro (:root)', lerBloco(':root')],
  ['escuro ([data-theme="dark"])', lerBloco('[data-theme="dark"]')],
];

describe.each(TEMAS)('contraste dos tokens no tema %s', (_nome, cores) => {
  it('define todos os tokens de cor usados nos pares', () => {
    const usados = new Set(PARES.flatMap(([frente, fundo]) => [frente, fundo]));
    expect(Object.keys(cores)).toEqual(expect.arrayContaining([...usados]));
  });

  it.each(PARES)('%s sobre %s atinge %s:1', (frente, fundo, minimo) => {
    const razao = contraste(cores[frente] ?? '', cores[fundo] ?? '');
    expect(razao).toBeGreaterThanOrEqual(minimo);
  });
});
