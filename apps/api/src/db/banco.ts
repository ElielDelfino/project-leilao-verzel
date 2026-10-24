// Cliente de banco compartilhado pelos módulos da API (specs/001 §Módulos: operações atômicas
// entre módulos recebem a mesma `tx`). Pool `pg` + Drizzle; todo erro que sai de `consultar` e
// `transaction` passa por converterErroDoBanco (sem SQL nem valores de parâmetro).
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolClient } from 'pg';

import type { ConexaoDoBanco } from './conexao.js';
import { converterErroDoBanco, paraErroDoBanco } from './erros.js';

/**
 * Dentro do callback de `consultar`/`transaction` o erro de uma consulta ainda é o do Drizzle
 * (DrizzleQueryError, com SQL e parâmetros na mensagem). Quem o captura para decidir (por
 * exemplo, 23505 → EMAIL_EM_USO) ou para embrulhá-lo num erro de domínio deve passá-lo antes
 * por converterErroDoBanco, que também converte a cadeia de `cause` sem alterar o original:
 *
 *   } catch (erro) {
 *     const convertido = converterErroDoBanco(erro);
 *     if (convertido instanceof ErroDoBanco && convertido.codigo === '23505') { ... }
 *     throw convertido;
 *   }
 */
export { converterErroDoBanco, ErroDoBanco } from './erros.js';

/** Instância Drizzle sobre o pool. Só chega aos módulos dentro de `consultar`. */
export type BancoDrizzle = NodePgDatabase;

/** Transação recebida pelo callback de `transaction`; repasse-a às interfaces dos outros módulos. */
export type Transacao = Parameters<Parameters<BancoDrizzle['transaction']>[0]>[0];

/**
 * Limites do pool, para uma e2-micro (1 GB, ADR 0013) com um Postgres de 300 MB. Os três
 * últimos são parâmetros de sessão do Postgres, aplicados a cada conexão.
 */
export const LIMITES_DO_POOL = Object.freeze({
  /** Conexões simultâneas. */
  max: 10,
  /** Espera por uma conexão (nova ou do pool) antes de falhar. */
  connectionTimeoutMillis: 5_000,
  /** Conexão ociosa é fechada depois deste tempo. */
  idleTimeoutMillis: 30_000,
  /** Nenhuma consulta passa disto (statement_timeout). */
  statement_timeout: 10_000,
  /** Espera máxima por um lock de linha ou tabela, como o FOR UPDATE do lote (lock_timeout). */
  lock_timeout: 5_000,
  /** Transação aberta e parada além disto é encerrada pelo Postgres. */
  idle_in_transaction_session_timeout: 15_000,
});

export interface OpcoesDoBanco {
  /** Conexão lida por lerConexaoDoBanco (conexao.ts). Contém a senha: nunca a registre. */
  readonly conexao: ConexaoDoBanco;
  /**
   * Chamado quando uma conexão do pool falha fora de uma consulta (queda do Postgres, por
   * exemplo), esteja ela ociosa ou emprestada. Sem listener, o `pg` derrubaria o processo. O
   * erro chega como ErroDoBanco só com o código (SQLSTATE ou ECONNRESET etc.). Se este callback
   * lançar, o erro dele vai para o stderr em vez de derrubar o processo.
   */
  readonly aoErroOcioso: (erro: unknown) => void;
}

export interface Banco {
  /** Uma consulta (ou várias, sem atomicidade) fora de transação. */
  consultar<T>(fn: (db: BancoDrizzle) => Promise<T>): Promise<T>;
  /** BEGIN, o callback e COMMIT; qualquer erro faz ROLLBACK e é repassado já convertido. */
  transaction<T>(fn: (tx: Transacao) => Promise<T>): Promise<T>;
  /** Fecha o pool, esperando as conexões em uso terminarem. Chamar de novo não faz nada. */
  encerrar(): Promise<void>;
}

async function comErroConvertido<T>(operacao: () => Promise<T>): Promise<T> {
  try {
    return await operacao();
  } catch (erro: unknown) {
    throw converterErroDoBanco(erro);
  }
}

/** Avisa o erro de conexão uma vez só (o pg-pool o emite no cliente e de novo no pool). */
function criarAvisoDeErro(aoErroOcioso: (erro: unknown) => void): (erro: Error) => void {
  const avisados = new WeakSet<object>();
  return (erro) => {
    if (avisados.has(erro)) {
      return;
    }
    avisados.add(erro);
    try {
      aoErroOcioso(paraErroDoBanco(erro));
    } catch (falha: unknown) {
      const nome = falha instanceof Error ? falha.name : typeof falha;
      process.stderr.write(`[db] aoErroOcioso lançou ${nome}; o erro de conexão foi descartado\n`);
    }
  };
}

export function criarBanco(opcoes: OpcoesDoBanco): Banco {
  const { conexao } = opcoes;
  // Objeto novo e explícito: o pg-pool copia as opções com Object.assign, que ignoraria a senha
  // (não enumerável em ConexaoDoBanco). O pg-pool esconde a senha das opções dele.
  const pool = new Pool({
    host: conexao.host,
    port: conexao.port,
    database: conexao.database,
    user: conexao.user,
    password: conexao.password,
    ...LIMITES_DO_POOL,
  });
  const avisar = criarAvisoDeErro(opcoes.aoErroOcioso);
  pool.on('error', avisar);
  // O pg-pool tira o listener dele enquanto a conexão está emprestada: este fica sempre.
  pool.on('connect', (cliente: PoolClient) => {
    cliente.on('error', avisar);
  });
  const db = drizzle({ client: pool });
  let encerramento: Promise<void> | undefined;

  return {
    consultar: (fn) => comErroConvertido(() => fn(db)),
    transaction: (fn) => comErroConvertido(() => db.transaction(fn)),
    encerrar: () => {
      encerramento ??= pool.end();
      return encerramento;
    },
  };
}
