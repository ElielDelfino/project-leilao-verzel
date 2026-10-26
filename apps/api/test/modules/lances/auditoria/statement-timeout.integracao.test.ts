// Integração (Postgres real): o freio de duração das leituras públicas da auditoria (tarefa 111).
// `limitarDuracaoDaTransacao` aplica `statement_timeout` local à transação (set_config com
// is_local = true): uma consulta mais lenta é cancelada com 57014 e a configuração não vaza para a
// conexão devolvida ao pool. O pool tem uma conexão só, então o SHOW lê a mesma conexão usada.
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type Banco,
  type BancoDrizzle,
  converterErroDoBanco,
  ErroDoBanco,
  type Transacao,
} from '../../../../src/db/banco.js';
import {
  limitarDuracaoDaTransacao,
  ServicoDeAuditoria,
} from '../../../../src/modules/lances/auditoria.js';
import { ambienteDeTeste } from '../../../db/ambiente-de-teste.js';

const BANCO = ambienteDeTeste(process.env);
const LIMITE_MS = 50;
/** STATEMENT_TIMEOUT_DA_AUDITORIA_MS (5000) como o SHOW do Postgres o escreve. */
const FREIO_DO_SERVICO = '5s';
const UUID_INEXISTENTE = '0192f000-0000-7000-8000-00000000dead';

type Transacionar = BancoDrizzle['transaction'];

/**
 * Banco sobre o Drizzle real cuja `db.transaction` espia a transação do serviço: depois do
 * callback (com sucesso ou erro), lê `statement_timeout` dentro da mesma transação.
 */
function bancoQueEspiaATransacao(db: BancoDrizzle, vistos: string[]): Banco {
  const transacionar: Transacionar = (callback, opcoes) =>
    db.transaction(async (tx: Transacao) => {
      try {
        return await callback(tx);
      } finally {
        const { rows } = await tx.execute<{ statement_timeout: string }>(
          sql`show statement_timeout`,
        );
        vistos.push(rows[0]?.statement_timeout ?? 'sem linha');
      }
    }, opcoes);
  const espiao = new Proxy(db, {
    get: (alvo, prop, receptor): unknown =>
      prop === 'transaction' ? transacionar : Reflect.get(alvo, prop, receptor),
  });
  return {
    consultar: (fn) => fn(espiao),
    transaction: (fn) => db.transaction(fn),
    encerrar: () => Promise.resolve(),
  };
}

describe.skipIf(!BANCO.disponivel)('o serviço de auditoria aplica o freio (Postgres real)', () => {
  let pool: pg.Pool;
  let servico: ServicoDeAuditoria;
  const vistos: string[] = [];

  beforeAll(() => {
    const { host, port, database, user, password } = BANCO.conexao();
    pool = new pg.Pool({ host, port, database, user, password, max: 1 });
    servico = new ServicoDeAuditoria(bancoQueEspiaATransacao(drizzle({ client: pool }), vistos));
  });

  afterAll(async () => {
    await pool.end();
  });

  it('auditoriaDoLote lê com statement_timeout de 5 s na própria transação', async () => {
    vistos.length = 0;

    await expect(servico.auditoriaDoLote(UUID_INEXISTENTE)).rejects.toMatchObject({
      codigo: 'NAO_ENCONTRADO',
    });

    expect(vistos).toEqual([FREIO_DO_SERVICO]);
  });

  it('chavesPublicadas lê com statement_timeout de 5 s na própria transação', async () => {
    vistos.length = 0;

    await servico.chavesPublicadas();

    expect(vistos).toEqual([FREIO_DO_SERVICO]);
  });
});

describe.skipIf(!BANCO.disponivel)('statement_timeout local da auditoria (Postgres real)', () => {
  let pool: pg.Pool;
  let db: BancoDrizzle;
  let padrao: string;

  const statementTimeout = async (): Promise<string> => {
    const { rows } = await pool.query<{ statement_timeout: string }>('show statement_timeout');
    const valor = rows[0]?.statement_timeout;
    if (valor === undefined) throw new Error('SHOW statement_timeout sem linha');
    return valor;
  };

  beforeAll(async () => {
    // Campo a campo: `password` da conexão é não enumerável e o spread o perderia.
    const { host, port, database, user, password } = BANCO.conexao();
    pool = new pg.Pool({ host, port, database, user, password, max: 1 });
    db = drizzle({ client: pool });
    padrao = await statementTimeout();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('cancela a consulta que passa do limite com 57014', async () => {
    const tentativa = db.transaction(async (tx) => {
      await limitarDuracaoDaTransacao(tx, LIMITE_MS);
      await tx.execute(sql`select pg_sleep(1)`);
    });

    const erro = await tentativa.then(
      () => undefined,
      (e: unknown) => converterErroDoBanco(e),
    );
    expect(erro).toBeInstanceOf(ErroDoBanco);
    expect((erro as ErroDoBanco).codigo).toBe('57014');
    expect(await statementTimeout()).toBe(padrao);
  });

  it('vale só dentro da transação: depois do COMMIT a conexão volta ao padrão', async () => {
    const dentro = await db.transaction(async (tx) => {
      await limitarDuracaoDaTransacao(tx, LIMITE_MS);
      const { rows } = await tx.execute<{ statement_timeout: string }>(sql`show statement_timeout`);
      return rows[0]?.statement_timeout;
    });

    expect(dentro).toBe(`${String(LIMITE_MS)}ms`);
    expect(padrao).not.toBe(dentro);
    expect(await statementTimeout()).toBe(padrao);
  });
});
