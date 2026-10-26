// Testes de `pnpm demo:lote` (task 143): servidor HTTP falso, sem Postgres nem Docker.
// Rodar: pnpm test:scripts
import { createServer } from 'node:http';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ErroDemo, executar, validarAmbiente } from './demo-lote.mjs';

const ORIGEM = 'http://localhost:15173';
const SENHA = 'senha-de-teste-123';
const LOTE_ID = '11111111-2222-4333-8444-555555555555';

/** Sobe um servidor falso que registra as chamadas e imita a API (CSRF, login, envelope). */
async function subirApiFalsa({ falharLogin = false, falharCriacao = false } = {}) {
  const chamadas = [];
  const servidor = createServer((req, res) => {
    let corpo = '';
    req.on('data', (c) => (corpo += c));
    req.on('end', () => {
      chamadas.push({
        metodo: req.method,
        caminho: req.url,
        origin: req.headers.origin,
        csrf: req.headers['x-csrf-token'],
        cookie: req.headers.cookie,
        idempotencia: req.headers['idempotency-key'],
        corpo: corpo ? JSON.parse(corpo) : undefined,
      });
      const json = (status, obj, extra = {}) => {
        res.writeHead(status, { 'Content-Type': 'application/json', ...extra });
        res.end(JSON.stringify(obj));
      };
      if (req.url === '/api/auth/csrf') {
        res.writeHead(204, { 'Set-Cookie': 'csrf_token=tok123; Path=/' });
        return res.end();
      }
      if (req.url === '/api/auth/login') {
        if (falharLogin)
          return json(401, { sucesso: false, erro: { codigo: 'CREDENCIAIS_INVALIDAS' } });
        return json(
          200,
          { sucesso: true, dados: { usuario: {} } },
          { 'Set-Cookie': ['acesso=abc; Path=/; HttpOnly'] },
        );
      }
      if (req.url === '/api/carteira/depositos') return json(201, { sucesso: true, dados: {} });
      if (req.url.startsWith('/api/catalogo/cartas')) {
        return json(200, {
          sucesso: true,
          dados: [{ scryfallId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }],
          meta: {},
        });
      }
      if (req.url === '/api/painel/lotes') {
        if (falharCriacao)
          return json(503, {
            sucesso: false,
            erro: { codigo: 'CATALOGO_INDISPONIVEL', detalhes: { senha: SENHA } },
          });
        return json(201, { sucesso: true, dados: { id: LOTE_ID } });
      }
      if (req.url === `/api/lotes/${LOTE_ID}/lances`)
        return json(201, { sucesso: true, dados: {} });
      return json(404, { sucesso: false, erro: { codigo: 'NAO_ENCONTRADO' } });
    });
  });
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${servidor.address().port}`;
  return { url, chamadas, fechar: () => new Promise((ok) => servidor.close(ok)) };
}

const envBase = (url) => ({ API_URL: url, WEB_ORIGIN: ORIGEM, SEED_DEMO_PASSWORD: SENHA });

describe('recusas antes de qualquer requisição', () => {
  it('recusa host fora de loopback', async () => {
    let chamou = false;
    const fetchImpl = async () => {
      chamou = true;
      throw new Error('não deveria chamar');
    };
    for (const API_URL of [
      'https://leilao.duckdns.org',
      'http://10.0.0.5:13000',
      'http://localhost.evil.com',
    ]) {
      await assert.rejects(
        executar({ env: { ...envBase(API_URL) }, fetchImpl, saida: () => {} }),
        (e) => e instanceof ErroDemo && /localhost|loopback|Recusado/.test(e.message),
      );
    }
    assert.equal(chamou, false);
  });

  it('aceita localhost, 127.0.0.1 e ::1', () => {
    assert.equal(validarAmbiente({ API_URL: 'http://localhost:13000' }), 'http://localhost:13000');
    assert.equal(validarAmbiente({ API_URL: 'http://127.0.0.1:13000' }), 'http://127.0.0.1:13000');
    assert.equal(validarAmbiente({ API_URL: 'http://[::1]:13000' }), 'http://[::1]:13000');
    assert.equal(validarAmbiente({}), 'http://localhost:13000');
  });

  it('recusa NODE_ENV=production mesmo com host local', async () => {
    let chamou = false;
    const fetchImpl = async () => {
      chamou = true;
    };
    await assert.rejects(
      executar({
        env: { ...envBase('http://localhost:13000'), NODE_ENV: 'production' },
        fetchImpl,
        saida: () => {},
      }),
      /NODE_ENV=production/,
    );
    assert.equal(chamou, false);
  });
});

describe('fluxo feliz', () => {
  it('chama a API na ordem, com Origin e CSRF, e imprime id e comando de adulteração', async () => {
    const api = await subirApiFalsa();
    try {
      const saida = [];
      const { loteId } = await executar({
        env: envBase(api.url),
        saida: (l) => saida.push(l),
        intervaloMs: 0,
      });
      assert.equal(loteId, LOTE_ID);

      const rotas = api.chamadas.map((c) => `${c.metodo} ${c.caminho.split('?')[0]}`);
      assert.deepEqual(rotas.slice(0, 6), [
        'GET /api/auth/csrf',
        'POST /api/auth/login',
        'GET /api/auth/csrf',
        'POST /api/auth/login',
        'GET /api/auth/csrf',
        'POST /api/auth/login',
      ]);
      assert.deepEqual(rotas.slice(6, 9), [
        'POST /api/carteira/depositos',
        'POST /api/carteira/depositos',
        'GET /api/catalogo/cartas',
      ]);
      assert.equal(rotas[9], 'POST /api/painel/lotes');
      const lances = api.chamadas.filter((c) => c.caminho.endsWith('/lances'));
      assert.ok(lances.length >= 6 && lances.length <= 8);
      assert.equal(lances.length, 8);

      // Origin em toda requisição; CSRF igual ao cookie em toda mutação.
      assert.ok(api.chamadas.every((c) => c.origin === ORIGEM));
      for (const c of api.chamadas.filter((x) => x.metodo === 'POST')) {
        assert.equal(c.csrf, 'tok123');
        assert.match(c.cookie, /csrf_token=tok123/);
      }
      // Lances alternados, crescentes, com chave de idempotência única.
      const valores = lances.map((l) => l.corpo.valorCentavos);
      assert.deepEqual(
        valores,
        [...valores].sort((a, b) => a - b),
      );
      assert.equal(new Set(lances.map((l) => l.idempotencia)).size, lances.length);
      const depositos = api.chamadas.filter((c) => c.caminho === '/api/carteira/depositos');
      assert.equal(new Set(depositos.map((d) => d.idempotencia)).size, 2);

      const texto = saida.join('\n');
      assert.match(texto, new RegExp(LOTE_ID));
      assert.match(texto, new RegExp(`${ORIGEM}/auditoria/${LOTE_ID}`));
      assert.match(texto, new RegExp(`${ORIGEM}/lotes/${LOTE_ID}`));
      assert.match(
        texto,
        new RegExp(`DEMO_ADULTERAR=1 pnpm demo:adulterar --lote ${LOTE_ID} --seq 1`),
      );
      assert.match(texto, /5 minutos/);
      assert.ok(!texto.includes(SENHA));
    } finally {
      await api.fechar();
    }
  });
});

describe('falhas', () => {
  it('falha de login sugere pnpm db:seed e não vaza a senha', async () => {
    const api = await subirApiFalsa({ falharLogin: true });
    try {
      await assert.rejects(
        executar({ env: envBase(api.url), saida: () => {}, intervaloMs: 0 }),
        (e) =>
          e instanceof ErroDemo && /pnpm db:seed/.test(e.message) && !e.message.includes(SENHA),
      );
      assert.ok(api.chamadas.every((c) => c.caminho.startsWith('/api/auth/')));
    } finally {
      await api.fechar();
    }
  });

  it('erro de API aparece só com o código', async () => {
    const api = await subirApiFalsa({ falharCriacao: true });
    try {
      await assert.rejects(
        executar({ env: envBase(api.url), saida: () => {}, intervaloMs: 0 }),
        (e) => {
          assert.ok(e instanceof ErroDemo);
          assert.match(e.message, /CATALOGO_INDISPONIVEL/);
          assert.ok(!e.message.includes(SENHA));
          return true;
        },
      );
    } finally {
      await api.fechar();
    }
  });
});
