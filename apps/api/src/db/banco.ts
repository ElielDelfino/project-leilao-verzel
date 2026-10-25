// Cliente de banco compartilhado pelos módulos da API (specs/001 §Módulos: operações atômicas
// entre módulos recebem a mesma `tx`). Pool `pg` + Drizzle; todo erro que sai de `consultar` e
// `transaction` passa por converterErroDoBanco (sem SQL nem valores de parâmetro).
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg, { Pool, type PoolClient } from 'pg';

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
   * lançar, o erro dele vai para o stderr em vez de derrubar o processo. Também recebe a falha
   * ao cancelar a consulta de `verificar` depois de um abort.
   */
  readonly aoErroOcioso: (erro: unknown) => void;
  /** Consulta de `verificar`. Padrão `select 1`; os testes usam uma lenta (pg_sleep). */
  readonly consultaDeVerificacao?: string;
}

export interface Banco {
  /** Uma consulta (ou várias, sem atomicidade) fora de transação. */
  consultar<T>(fn: (db: BancoDrizzle) => Promise<T>): Promise<T>;
  /** BEGIN, o callback e COMMIT; qualquer erro faz ROLLBACK e é repassado já convertido. */
  transaction<T>(fn: (tx: Transacao) => Promise<T>): Promise<T>;
  /** Fecha o pool, esperando as conexões em uso terminarem. Chamar de novo não faz nada. */
  encerrar(): Promise<void>;
}

/**
 * Banco com a verificação de prontidão (pendência da 017). Interface à parte para não quebrar
 * quem implementa Banco (dublês de teste); criarBanco devolve esta.
 */
export interface BancoVerificavel extends Banco {
  /**
   * `select 1` numa conexão do pool. Se `sinal` disparar, rejeita na hora com `sinal.reason`,
   * cancela a consulta no servidor (pg_cancel_backend, por outra conexão) e descarta a conexão
   * em vez de devolvê-la ao pool. Sinal já disparado: rejeita sem pegar conexão.
   */
  verificar(sinal: AbortSignal): Promise<void>;
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

const CONSULTA_DE_VERIFICACAO = 'select 1';

/** Cancela no servidor a consulta do backend `pid`, por uma conexão avulsa (o pool pode estar cheio). */
async function cancelarNoServidor(conexao: ConexaoDoBanco, pid: number): Promise<void> {
  const cliente = new pg.Client({
    host: conexao.host,
    port: conexao.port,
    database: conexao.database,
    user: conexao.user,
    password: conexao.password,
    connectionTimeoutMillis: LIMITES_DO_POOL.connectionTimeoutMillis,
  });
  cliente.on('error', () => undefined);
  try {
    await cliente.connect();
    await cliente.query('select pg_cancel_backend($1)', [pid]);
  } finally {
    await cliente.end();
  }
}

/** Rejeita quando o sinal dispara; `desligar` remove o listener. */
function quandoAbortar(sinal: AbortSignal): { promessa: Promise<never>; desligar: () => void } {
  let desligar = (): void => undefined;
  const promessa = new Promise<never>((_, rejeitar) => {
    const aoAbortar = (): void => {
      rejeitar(sinal.reason);
    };
    sinal.addEventListener('abort', aoAbortar, { once: true });
    desligar = () => {
      sinal.removeEventListener('abort', aoAbortar);
    };
  });
  return { promessa, desligar };
}

/**
 * Pega uma conexão, descobre o pid do backend e roda a consulta. Se o sinal disparar durante a
 * consulta, pede o cancelamento no servidor e descarta a conexão (release(true)) em vez de
 * devolvê-la ao pool: um cancelamento atrasado nunca atinge a consulta de outra pessoa.
 */
async function executarVerificacao(
  pool: Pool,
  consulta: string,
  sinal: AbortSignal,
  cancelar: (pid: number) => void,
): Promise<void> {
  const cliente = await pool.connect();
  let cancelada = false;
  try {
    if (sinal.aborted) {
      return;
    }
    const { rows } = await cliente.query<{ pid: number }>('select pg_backend_pid() as pid');
    const pid = Number(rows[0]?.pid);
    if (sinal.aborted) {
      return;
    }
    const aoAbortar = (): void => {
      cancelada = true;
      cancelar(pid);
    };
    sinal.addEventListener('abort', aoAbortar, { once: true });
    try {
      await cliente.query(consulta);
    } finally {
      sinal.removeEventListener('abort', aoAbortar);
    }
  } finally {
    cliente.release(cancelada);
  }
}

function criarVerificar(
  pool: Pool,
  conexao: ConexaoDoBanco,
  consulta: string,
  avisar: (erro: Error) => void,
): (sinal: AbortSignal) => Promise<void> {
  const cancelar = (pid: number): void => {
    cancelarNoServidor(conexao, pid).catch((falha: unknown) => {
      avisar(falha instanceof Error ? falha : new Error('falha ao cancelar a verificação'));
    });
  };
  return async (sinal) => {
    sinal.throwIfAborted();
    const aborto = quandoAbortar(sinal);
    const trabalho = executarVerificacao(pool, consulta, sinal, cancelar);
    // Depois de um abort, o resultado do trabalho (inclusive o erro 57014) é descartado.
    trabalho.catch(() => undefined);
    aborto.promessa.catch(() => undefined);
    try {
      await Promise.race([trabalho, aborto.promessa]);
    } catch (erro: unknown) {
      throw sinal.aborted ? sinal.reason : converterErroDoBanco(erro);
    } finally {
      aborto.desligar();
    }
  };
}

export function criarBanco(opcoes: OpcoesDoBanco): BancoVerificavel {
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
    verificar: criarVerificar(
      pool,
      conexao,
      opcoes.consultaDeVerificacao ?? CONSULTA_DE_VERIFICACAO,
      avisar,
    ),
    consultar: (fn) => comErroConvertido(() => fn(db)),
    transaction: (fn) => comErroConvertido(() => db.transaction(fn)),
    encerrar: () => {
      encerramento ??= pool.end();
      return encerramento;
    },
  };
}
