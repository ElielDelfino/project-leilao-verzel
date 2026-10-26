// Testes da CSP e da borda do Caddyfile (tasks 064 e 129, ADR 0024, 0029 e 0033) e das portas
// do compose de produção. Rodar: pnpm test:scripts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { parse } from 'yaml';

const caddyfile = readFileSync(new URL('../infra/caddy/Caddyfile', import.meta.url), 'utf8');
const composeProd = parse(
  readFileSync(new URL('../infra/docker-compose.prod.yml', import.meta.url), 'utf8'),
  { merge: true },
);

/** Linhas do Caddyfile sem comentários nem espaços nas pontas. */
const diretivasDoCaddyfile = caddyfile
  .split('\n')
  .map((l) => l.replace(/#.*$/, '').trim())
  .filter(Boolean);

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

test('só HTTP/1.1 e HTTP/2, sem HTTP/3 (ADR 0024)', () => {
  const protocolos = diretivasDoCaddyfile.filter((l) => l.startsWith('protocols'));
  assert.deepEqual(protocolos, ['protocols h1 h2']);
});

test('HTTPS automático e redirecionamento de HTTP ligados (ADR 0033, item 2)', () => {
  // auto_https off ou disable_redirects desligariam o redirecionamento de http:// para https://.
  assert.ok(!diretivasDoCaddyfile.some((l) => l.startsWith('auto_https')), 'auto_https presente');
  // O site público vem de CADDY_SITE_ADDRESS, sem esquema http:// (que serviria em texto claro).
  assert.ok(diretivasDoCaddyfile.includes('{$CADDY_SITE_ADDRESS:localhost} {'));
});

test('HSTS, nosniff e frame-ancestors none em todas as respostas', () => {
  assert.ok(
    diretivasDoCaddyfile.includes(
      'Strict-Transport-Security "max-age=31536000; includeSubDomains"',
    ),
  );
  assert.ok(diretivasDoCaddyfile.includes('X-Content-Type-Options "nosniff"'));
  assert.equal(diretivas().get('frame-ancestors'), "'none'");
});

test('compose de produção: só o Caddy publica portas, 80 e 443 TCP (specs/014 §Servidor)', () => {
  const comPortas = Object.entries(composeProd.services)
    .filter(([, servico]) => servico.ports !== undefined || servico.expose !== undefined)
    .map(([nome]) => nome);
  assert.deepEqual(comPortas, ['caddy']);
  assert.deepEqual(composeProd.services.caddy.ports, [
    '${CADDY_HTTP_PORT:-80}:80/tcp',
    '${CADDY_HTTPS_PORT:-443}:443/tcp',
  ]);
});

test('compose de produção: a API nunca recebe a senha do dono do banco (specs/014 §Segredos)', () => {
  const api = composeProd.services.api;
  assert.ok(!('DB_PASSWORD_FILE' in api.environment));
  assert.ok(!('DB_PASSWORD' in api.environment));
  assert.ok(!api.secrets.includes('db_password'));
});

test('compose de produção: borda com subnet fixa e TRUSTED_PROXY_CIDR igual a ela (task 139)', () => {
  const [config] = composeProd.networks.borda.ipam.config;
  const subnet = /^\$\{BORDA_SUBNET:-([0-9.]+\/\d+)\}$/.exec(config.subnet);
  assert.ok(subnet, 'subnet da borda deve vir de BORDA_SUBNET com padrão fixo');
  const cidr = /^\$\{BORDA_SUBNET:-([0-9.]+\/\d+)\}$/.exec(
    composeProd.services.api.environment.TRUSTED_PROXY_CIDR,
  );
  assert.ok(cidr, 'TRUSTED_PROXY_CIDR deve vir de BORDA_SUBNET');
  assert.equal(cidr[1], subnet[1]);
  assert.match(subnet[1], /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/, 'faixa privada');
  assert.equal(composeProd.networks.dados.ipam, undefined, 'dados não compete pela faixa');
  assert.equal(composeProd.services.caddy.environment.TRUSTED_PROXY_CIDR, undefined);
});

test('Caddyfile não confia em X-Forwarded-For do cliente (sem trusted_proxies)', () => {
  assert.equal(
    diretivasDoCaddyfile.some((d) => /trusted_proxies/.test(d)),
    false,
  );
});
