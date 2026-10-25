// Integração (Postgres real): cliente compartilhado de banco (tarefa 003). Não grava nada:
// a única escrita (um schema) acontece numa transação que o próprio teste desfaz.
import { randomBytes } from 'node:crypto';

import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { type Banco, converterErroDoBanco, criarBanco, ErroDoBanco } from '../../src/db/banco.js';
import { serializarErro } from '../../src/logger/logger.js';
import { ambienteDeTeste } from './ambiente-de-teste.js';

// Com LEILAO_TEST_DB definido, falta de variável derruba a coleta; sem ele, estes testes são
// pulados (ambiente-de-teste.ts).
const AMBIENTE = ambienteDeTeste(process.env);
const VALOR_SENSIVEL = 'ana@demo.local';

/** SQLSTATE admin_shutdown: conexão encerrada por pg_terminate_backend. */
const SQLSTATE_CONEXAO_ENCERRADA = '57P01';

async function falhaDe(promessa: Promise<unknown>): Promise<unknown> {
  try {
    await promessa;
  } catch (erro: unknown) {
    return erro;
  }
  throw new Error('a operação deveria ter falhado');
}

async function encerrarConexao(pid: number): Promise<void> {
  const cliente = new pg.Client(AMBIENTE.conexao());
  await cliente.connect();
  try {
    await cliente.query('select pg_terminate_backend($1)', [pid]);
  } finally {
    await cliente.end();
  }
}

async function esperarAte(condicao: () => boolean): Promise<void> {
  await vi.waitFor(() => {
    expect(condicao()).toBe(true);
  });
}

class ErroDeDominio extends Error {
  override readonly name = 'ErroDeDominio';
}

describe.skipIf(!AMBIENTE.disponivel)('criarBanco', () => {
  const errosOciosos: unknown[] = [];
  let banco: Banco;

  beforeAll(() => {
    banco = criarBanco({
      conexao: AMBIENTE.conexao(),
      aoErroOcioso: (erro) => errosOciosos.push(erro),
    });
  });

  afterAll(async () => {
    await banco.encerrar();
    expect(errosOciosos).toEqual([]);
  });

  it('consultar devolve o resultado da consulta', async () => {
    const resultado = await banco.consultar((db) => db.execute(sql`select 1 + 1 as soma`));

    expect(resultado.rows).toEqual([{ soma: 2 }]);
  });

  it('aplica os limites de sessão em cada conexão', async () => {
    const { rows } = await banco.consultar((db) =>
      db.execute(sql`select current_setting('statement_timeout') as statement_timeout,
                            current_setting('lock_timeout') as lock_timeout,
                            current_setting('idle_in_transaction_session_timeout') as ociosa`),
    );

    expect(rows).toEqual([{ statement_timeout: '10s', lock_timeout: '5s', ociosa: '15s' }]);
  });

  it('consultar converte o erro do driver sem o valor do parâmetro', async () => {
    const erro = await falhaDe(
      banco.consultar((db) => db.execute(sql`select ${VALOR_SENSIVEL}::uuid`)),
    );

    expect(erro).toBeInstanceOf(ErroDoBanco);
    expect(erro instanceof ErroDoBanco && erro.codigo).toBe('22P02');
    expect(JSON.stringify(erro)).not.toContain(VALOR_SENSIVEL);
    expect(erro instanceof Error && erro.message).not.toContain(VALOR_SENSIVEL);
    expect(erro instanceof Error && erro.stack).not.toContain(VALOR_SENSIVEL);
  });

  it('transaction confirma e devolve o valor do callback', async () => {
    const valor = await banco.transaction(async (tx) => {
      const { rows } = await tx.execute(
        sql`select current_setting('transaction_isolation') as nivel`,
      );
      return rows[0];
    });

    expect(valor).toEqual({ nivel: 'read committed' });
  });

  it('transaction desfaz tudo e converte o erro do driver', async () => {
    const esquema = `t003_${randomBytes(6).toString('hex')}`;

    const erro = await falhaDe(
      banco.transaction(async (tx) => {
        await tx.execute(sql.raw(`create schema ${esquema}`));
        await tx.execute(sql`select ${VALOR_SENSIVEL}::uuid`);
      }),
    );

    expect(erro).toBeInstanceOf(ErroDoBanco);
    expect(erro instanceof Error && erro.message).not.toContain(VALOR_SENSIVEL);
    const { rows } = await banco.consultar((db) =>
      db.execute(sql`select to_regnamespace(${esquema}) is null as desfeito`),
    );
    expect(rows).toEqual([{ desfeito: true }]);
  });

  it('transaction repassa sem conversão o erro que não vem do driver', async () => {
    const dominio = new Error('SALDO_INSUFICIENTE');

    const erro = await falhaDe(
      banco.transaction(() => {
        throw dominio;
      }),
    );

    expect(erro).toBe(dominio);
  });

  it('erro de domínio com cause do driver sai com a cause convertida', async () => {
    const erro = await falhaDe(
      banco.transaction(async (tx) => {
        try {
          await tx.execute(sql`select ${VALOR_SENSIVEL}::uuid`);
        } catch (causa: unknown) {
          throw new ErroDeDominio('e-mail inválido', { cause: causa });
        }
      }),
    );

    expect(erro).toBeInstanceOf(ErroDeDominio);
    expect(erro instanceof Error && erro.cause).toBeInstanceOf(ErroDoBanco);
    const linhaDeLog = JSON.stringify(serializarErro(erro));
    expect(linhaDeLog).not.toContain(VALOR_SENSIVEL);
    expect(linhaDeLog).not.toContain('select');
  });

  it('converterErroDoBanco, exportado aqui, serve dentro do callback', async () => {
    const codigo = await banco.transaction(async (tx) => {
      try {
        await tx.execute(sql`select ${VALOR_SENSIVEL}::uuid`);
        return undefined;
      } catch (erro: unknown) {
        const convertido = converterErroDoBanco(erro);
        return convertido instanceof ErroDoBanco ? convertido.codigo : 'não convertido';
      }
    });

    // A transação ficou abortada pelo erro, mas o callback não lançou: o Drizzle tenta COMMIT,
    // que vira ROLLBACK no Postgres. O código veio convertido.
    expect(codigo).toBe('22P02');
  });

  it('encerrar é idempotente', async () => {
    const outro = criarBanco({ conexao: AMBIENTE.conexao(), aoErroOcioso: () => undefined });
    await outro.consultar((db) => db.execute(sql`select 1`));

    await outro.encerrar();
    await expect(outro.encerrar()).resolves.toBeUndefined();
  });
});

describe.skipIf(!AMBIENTE.disponivel)('criarBanco: queda de conexão fora de consulta', () => {
  it('conexão emprestada: avisa aoErroOcioso em vez de derrubar o processo', async () => {
    const avisos: unknown[] = [];
    const outro = criarBanco({ conexao: AMBIENTE.conexao(), aoErroOcioso: (e) => avisos.push(e) });
    try {
      await outro.consultar(async (db) => {
        const { rows } = await db.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
        await encerrarConexao(Number(rows[0]?.pid));
        await esperarAte(() => avisos.length > 0);
      });

      expect(avisos).toHaveLength(1);
      expect(avisos[0]).toBeInstanceOf(ErroDoBanco);
      expect(avisos[0] instanceof ErroDoBanco && avisos[0].codigo).toBe(SQLSTATE_CONEXAO_ENCERRADA);
    } finally {
      await outro.encerrar();
    }
  });

  it('conexão ociosa: avisa uma vez só, e um aoErroOcioso que lança não derruba nada', async () => {
    let chamadas = 0;
    const saida = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const outro = criarBanco({
      conexao: AMBIENTE.conexao(),
      aoErroOcioso: () => {
        chamadas += 1;
        throw new Error('listener quebrado');
      },
    });
    try {
      const { rows } = await outro.consultar((db) =>
        db.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`),
      );
      await encerrarConexao(Number(rows[0]?.pid));
      await esperarAte(() => chamadas > 0);

      expect(chamadas).toBe(1);
      expect(saida).toHaveBeenCalledWith(expect.stringContaining('aoErroOcioso lançou Error'));
    } finally {
      saida.mockRestore();
      await outro.encerrar();
    }
  });
});

describe.skipIf(!AMBIENTE.disponivel)('criarBanco: verificar(sinal) (pendência da 017)', () => {
  const LENTA = 'select pg_sleep(5)';

  async function lentasNoServidor(): Promise<number> {
    const cliente = new pg.Client(AMBIENTE.conexao());
    await cliente.connect();
    try {
      const { rows } = await cliente.query<{ total: number }>(
        `select count(*)::int as total from pg_stat_activity
          where query = $1 and state = 'active' and datname = current_database()`,
        [LENTA],
      );
      return Number(rows[0]?.total);
    } finally {
      await cliente.end();
    }
  }

  it('resolve com select 1', async () => {
    const outro = criarBanco({ conexao: AMBIENTE.conexao(), aoErroOcioso: () => undefined });
    try {
      await expect(outro.verificar(new AbortController().signal)).resolves.toBeUndefined();
    } finally {
      await outro.encerrar();
    }
  });

  it('sinal já disparado: rejeita com o motivo, sem consultar', async () => {
    const outro = criarBanco({ conexao: AMBIENTE.conexao(), aoErroOcioso: () => undefined });
    const motivo = new Error('tempo esgotado');
    try {
      await expect(outro.verificar(AbortSignal.abort(motivo))).rejects.toBe(motivo);
    } finally {
      await outro.encerrar();
    }
  });

  it('interrompe um pg_sleep(5) em menos de 1 s depois do abort e o cancela no servidor', async () => {
    const avisos: unknown[] = [];
    const outro = criarBanco({
      conexao: AMBIENTE.conexao(),
      aoErroOcioso: (erro) => avisos.push(erro),
      consultaDeVerificacao: LENTA,
    });
    const controle = new AbortController();
    const motivo = new Error('tempo esgotado');
    try {
      const verificacao = outro.verificar(controle.signal);
      await vi.waitFor(
        async () => {
          expect(await lentasNoServidor()).toBe(1);
        },
        { timeout: 5000 },
      );

      const inicio = performance.now();
      controle.abort(motivo);
      const erro = await verificacao.catch((e: unknown) => e);
      const decorrido = performance.now() - inicio;

      expect(erro).toBe(motivo);
      expect(decorrido).toBeLessThan(1000);
      await vi.waitFor(
        async () => {
          expect(await lentasNoServidor()).toBe(0);
        },
        { timeout: 5000 },
      );
      // O pool continua utilizável depois do cancelamento.
      const { rows } = await outro.consultar((db) => db.execute(sql`select 1 as um`));
      expect(rows).toEqual([{ um: 1 }]);
      expect(avisos).toEqual([]);
    } finally {
      await outro.encerrar();
    }
  });
});
