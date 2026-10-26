// Testes de `pnpm demo:adulterar` (task 123, specs/008): parser e recusas, sem banco.
// A verificação com banco (a auditoria acusa o seq) fica na task 121. Rodar: pnpm test:scripts
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ErroDeUso,
  adulterar,
  exigirAmbienteLocal,
  lerArgumentos,
  lerConexaoDoDono,
} from './demo-adulterar.mjs';

const LOTE = '0194a0b2-7c3d-7e4f-8a1b-2c3d4e5f6a7b';
const SCRIPT = resolve(import.meta.dirname, 'demo-adulterar.mjs');
const SENHA = 'S'.repeat(43);

function executar(args, env) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    env: { PATH: process.env.PATH, ...env },
    encoding: 'utf8',
  });
}

describe('lerArgumentos', () => {
  it('lê lote e seq', () => {
    const a = lerArgumentos(['--lote', LOTE.toUpperCase(), '--seq', '3']);
    assert.deepEqual({ ...a }, { lote: LOTE, seq: 3, restaurar: false, valor: undefined });
  });

  it('lê a restauração com valor', () => {
    const a = lerArgumentos(['--lote', LOTE, '--seq', '2', '--restaurar', '--valor', '12345']);
    assert.equal(a.restaurar, true);
    assert.equal(a.valor, 12345n);
  });

  it('ignora o separador -- repassado pelo pnpm', () => {
    assert.equal(lerArgumentos(['--', '--lote', LOTE, '--seq', '1']).seq, 1);
  });

  for (const [nome, args] of [
    ['sem argumentos', []],
    ['sem --seq', ['--lote', LOTE]],
    ['sem --lote', ['--seq', '1']],
    ['lote que não é UUID', ['--lote', 'abc', '--seq', '1']],
    ['seq zero', ['--lote', LOTE, '--seq', '0']],
    ['seq negativo', ['--lote', LOTE, '--seq', '-1']],
    ['seq decimal', ['--lote', LOTE, '--seq', '1.5']],
    ['seq texto', ['--lote', LOTE, '--seq', 'x']],
    ['seq sem valor', ['--lote', LOTE, '--seq']],
    ['seq repetido', ['--lote', LOTE, '--seq', '1', '--seq', '2']],
    ['argumento desconhecido', ['--lote', LOTE, '--seq', '1', '--x']],
    ['restaurar sem valor', ['--lote', LOTE, '--seq', '1', '--restaurar']],
    [
      'restaurar com valor abaixo da faixa',
      ['--lote', LOTE, '--seq', '1', '--restaurar', '--valor', '99'],
    ],
    ['valor sem restaurar', ['--lote', LOTE, '--seq', '1', '--valor', '500']],
  ]) {
    it(`recusa ${nome}`, () => {
      assert.throws(() => lerArgumentos(args), ErroDeUso);
    });
  }
});

describe('exigirAmbienteLocal', () => {
  for (const host of ['127.0.0.1', '::1', 'localhost']) {
    it(`aceita o host ${host} com o opt-in`, () => {
      assert.doesNotThrow(() => exigirAmbienteLocal({ DEMO_ADULTERAR: '1', POSTGRES_HOST: host }));
    });
  }

  for (const optIn of [undefined, '', '0', 'true', 'yes']) {
    it(`recusa sem o opt-in DEMO_ADULTERAR=1 (valor ${String(optIn)})`, () => {
      assert.throws(
        () => exigirAmbienteLocal({ DEMO_ADULTERAR: optIn, POSTGRES_HOST: '127.0.0.1' }),
        /DEMO_ADULTERAR=1/,
      );
    });
  }

  it('recusa o host postgres do compose mesmo com o opt-in', () => {
    assert.throws(
      () => exigirAmbienteLocal({ DEMO_ADULTERAR: '1', POSTGRES_HOST: 'postgres' }),
      /POSTGRES_HOST fora de loopback/,
    );
  });

  it('recusa NODE_ENV=production', () => {
    assert.throws(
      () =>
        exigirAmbienteLocal({
          DEMO_ADULTERAR: '1',
          NODE_ENV: 'production',
          POSTGRES_HOST: '127.0.0.1',
        }),
      /production/,
    );
  });

  for (const host of ['db.exemplo.com', '10.0.0.5', '127.0.0.1.exemplo.com', undefined, '']) {
    it(`recusa o host ${String(host)}`, () => {
      assert.throws(
        () => exigirAmbienteLocal({ DEMO_ADULTERAR: '1', POSTGRES_HOST: host }),
        ErroDeUso,
      );
    });
  }
});

describe('lerConexaoDoDono', () => {
  const env = {
    POSTGRES_HOST: '127.0.0.1',
    POSTGRES_PORT: '15432',
    POSTGRES_DB: 'leilao',
    POSTGRES_USER: 'dono',
    DB_PASSWORD: SENHA,
  };

  it('não expõe a senha em JSON nem em Object.keys', () => {
    const conexao = lerConexaoDoDono(env);
    assert.equal(conexao.password, SENHA);
    assert.ok(!JSON.stringify(conexao).includes(SENHA));
    assert.ok(!Object.keys(conexao).includes('password'));
  });

  it('recusa variável ausente citando só o nome', () => {
    assert.throws(
      () => lerConexaoDoDono({ ...env, POSTGRES_USER: undefined }),
      (e) =>
        e instanceof ErroDeUso && /POSTGRES_USER/.test(e.message) && !e.message.includes(SENHA),
    );
  });

  it('recusa porta inválida e senha ausente', () => {
    assert.throws(() => lerConexaoDoDono({ ...env, POSTGRES_PORT: '70000' }), ErroDeUso);
    assert.throws(() => lerConexaoDoDono({ ...env, DB_PASSWORD: undefined }), ErroDeUso);
  });
});

describe('adulterar (cliente simulado)', () => {
  function clienteSimulado({ lance = { valor: '1000' }, lote = true, trigger = 'O' } = {}) {
    const consultas = [];
    return {
      consultas,
      async query(sql, params) {
        consultas.push({ sql, params });
        if (sql.startsWith('SELECT valor_centavos')) {
          return lance ? { rowCount: 1, rows: [lance] } : { rowCount: 0, rows: [] };
        }
        if (sql.startsWith('SELECT 1 FROM lots')) {
          return { rowCount: lote ? 1 : 0, rows: [] };
        }
        if (sql.startsWith('SELECT tgenabled')) {
          return { rowCount: 1, rows: [{ tgenabled: trigger }] };
        }
        return { rowCount: 0, rows: [] };
      },
    };
  }
  const base = { lote: LOTE, seq: 2, restaurar: false, valor: undefined };

  it('soma 1 centavo, desabilita e reabilita o trigger dentro da transação', async () => {
    const c = clienteSimulado();
    const r = await adulterar(c, base);
    assert.deepEqual(r, { anterior: 1000n, novo: 1001n });
    const sqls = c.consultas.map((q) => q.sql);
    assert.equal(sqls[0], 'BEGIN');
    assert.match(sqls[1], /^SET LOCAL lock_timeout/);
    assert.ok(
      sqls.findIndex((s) => /DISABLE TRIGGER/.test(s)) <
        sqls.findIndex((s) => /^UPDATE bids/.test(s)),
    );
    assert.ok(
      sqls.findIndex((s) => /^UPDATE bids/.test(s)) <
        sqls.findIndex((s) => /ENABLE TRIGGER/.test(s)),
    );
    assert.equal(sqls.at(-1), 'COMMIT');
    assert.deepEqual(c.consultas.find((q) => /^UPDATE bids/.test(q.sql)).params, [LOTE, 2, '1001']);
  });

  it('restaura o valor informado', async () => {
    const c = clienteSimulado({ lance: { valor: '1001' } });
    const r = await adulterar(c, { ...base, restaurar: true, valor: 1000n });
    assert.deepEqual(r, { anterior: 1001n, novo: 1000n });
  });

  it('seq inexistente: desfaz sem tocar no trigger', async () => {
    const c = clienteSimulado({ lance: null });
    await assert.rejects(adulterar(c, base), /não tem o lance/);
    const sqls = c.consultas.map((q) => q.sql);
    assert.ok(!sqls.some((s) => /TRIGGER/.test(s)));
    assert.equal(sqls.at(-1), 'ROLLBACK');
  });

  it('lote inexistente: desfaz', async () => {
    const c = clienteSimulado({ lance: null, lote: false });
    await assert.rejects(adulterar(c, base), /Lote inexistente/);
    assert.equal(c.consultas.at(-1).sql, 'ROLLBACK');
  });

  it('trigger que não volta habilitado: desfaz em vez de confirmar', async () => {
    const c = clienteSimulado({ trigger: 'D' });
    await assert.rejects(adulterar(c, base), /trigger/);
    assert.equal(c.consultas.at(-1).sql, 'ROLLBACK');
  });
});

describe('execução do script (recusas antes de conectar)', () => {
  const ambiente = {
    DEMO_ADULTERAR: '1',
    POSTGRES_HOST: '127.0.0.1',
    POSTGRES_PORT: '1',
    POSTGRES_DB: 'leilao',
    POSTGRES_USER: 'dono',
    DB_PASSWORD: SENHA,
  };

  it('sem --lote e --seq sai com código ≠ 0 e uso', () => {
    const r = executar([], ambiente);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /--lote/);
    assert.match(r.stderr, /Uso:/);
  });

  it('NODE_ENV=production recusa', () => {
    const r = executar(['--lote', LOTE, '--seq', '1'], { ...ambiente, NODE_ENV: 'production' });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /production/);
  });

  it('sem DEMO_ADULTERAR=1 recusa antes de conectar', () => {
    const semOptIn = { ...ambiente, DEMO_ADULTERAR: undefined };
    const r = executar(['--lote', LOTE, '--seq', '1'], semOptIn);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /DEMO_ADULTERAR=1/);
  });

  it('host postgres do compose recusa mesmo com o opt-in', () => {
    const r = executar(['--lote', LOTE, '--seq', '1'], { ...ambiente, POSTGRES_HOST: 'postgres' });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /POSTGRES_HOST fora de loopback/);
  });

  it('host remoto recusa sem imprimir segredo', () => {
    const r = executar(['--lote', LOTE, '--seq', '1'], {
      ...ambiente,
      POSTGRES_HOST: 'db.exemplo.com',
    });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /POSTGRES_HOST/);
    assert.ok(!r.stderr.includes(SENHA) && !r.stdout.includes(SENHA));
    assert.ok(!r.stderr.includes('db.exemplo.com'));
  });
});
