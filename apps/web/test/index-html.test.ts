import { describe, expect, it } from 'vitest';

import indexHtml from '../index.html?raw';

const documento = new DOMParser().parseFromString(indexHtml, 'text/html');

describe('index.html', () => {
  it('declara o idioma pt-BR (WCAG 3.1.1)', () => {
    expect(documento.documentElement.getAttribute('lang')).toBe('pt-BR');
  });

  it('permite zoom (sem maximum-scale nem user-scalable=no)', () => {
    const viewport =
      documento.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? '';
    expect(viewport).toContain('width=device-width');
    expect(viewport).not.toMatch(/maximum-scale|user-scalable\s*=\s*no/);
  });

  it('carrega o tema inicial como script externo, bloqueante, no <head>', () => {
    const script = documento.head.querySelector('script[src="/tema-inicial.js"]');
    expect(script).not.toBeNull();
    expect(script?.hasAttribute('type')).toBe(false);
    expect(script?.hasAttribute('defer')).toBe(false);
    expect(script?.hasAttribute('async')).toBe(false);
  });

  it('não tem script inline (CSP com script-src self)', () => {
    const inline = [...documento.querySelectorAll('script')].filter((s) => !s.hasAttribute('src'));
    expect(inline).toEqual([]);
  });
});
