// Testes da CSP do Caddyfile (task 064, ADR 0024 e 0029). Rodar: pnpm test:scripts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const caddyfile = readFileSync(new URL('../infra/caddy/Caddyfile', import.meta.url), 'utf8');

const linhas = caddyfile.split('\n').filter((l) => l.trim().startsWith('Content-Security-Policy'));

function diretivas() {
  const m = /^\s*Content-Security-Policy\s+"([^"]+)"/.exec(linhas[0] ?? '');
  assert.ok(m, 'CSP não encontrada no Caddyfile');
  return new Map(
    m[1]
      .split(';')
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => {
        const [nome, ...valores] = d.split(/\s+/);
        return [nome, valores.join(' ')];
      }),
  );
}

test('há exatamente um header Content-Security-Policy', () => {
  assert.equal(linhas.length, 1);
});

test("img-src é exatamente 'self' data: https://cards.scryfall.io", () => {
  assert.equal(diretivas().get('img-src'), "'self' data: https://cards.scryfall.io");
});

test("default-src, script-src, style-src, font-src e connect-src seguem 'self'", () => {
  const d = diretivas();
  for (const nome of ['default-src', 'script-src', 'style-src', 'font-src', 'connect-src']) {
    assert.equal(d.get(nome), "'self'", nome);
  }
});

test('demais diretivas restritivas permanecem', () => {
  const d = diretivas();
  assert.equal(d.get('object-src'), "'none'");
  assert.equal(d.get('base-uri'), "'self'");
  assert.equal(d.get('form-action'), "'self'");
  assert.equal(d.get('frame-ancestors'), "'none'");
});

test('nenhuma origem externa além de cards.scryfall.io', () => {
  const externas = [...(linhas[0] ?? '').matchAll(/https?:\/\/[^\s;"]+|\*/g)].map((m) => m[0]);
  assert.deepEqual(externas, ['https://cards.scryfall.io']);
});
