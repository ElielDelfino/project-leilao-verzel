// Cliente de banco compartilhado pelos módulos da API (specs/001 §Módulos: operações atômicas
// entre módulos recebem a mesma `tx`). Pool `pg` + Drizzle; todo erro do driver sai convertido
// por converterErroDoBanco (sem SQL nem valores de parâmetro).
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import type { ConexaoDoBanco } from './conexao.js';
import { converterErroDoBanco } from './erros.js';

/** Instância Drizzle sobre o pool. Só chega aos módulos dentro de `consultar`. */
export type BancoDrizzle = NodePgDatabase;

/** Transação recebida pelo callback de `transaction`; repasse-a às interfaces dos outros módulos. */
export type Transacao = Parameters<Parameters<BancoDrizzle['transaction']>[0]>[0];

export interface OpcoesDoBanco {
  /** Conexão lida por lerConexaoDoBanco (conexao.ts). Contém a senha: nunca a registre. */
  readonly conexao: ConexaoDoBanco;
  /**
   * Chamado quando uma conexão ociosa do pool falha (queda do Postgres, por exemplo). Sem um
   * listener, o `pg` derruba o processo; o erro já chega convertido.
   */
  readonly aoErroOcioso: (erro: unknown) => void;
}

export interface Banco {
  /** Uma consulta (ou várias, sem atomicidade) fora de transação. */
  consultar<T>(fn: (db: BancoDrizzle) => Promise<T>): Promise<T>;
  /** BEGIN, o callback e COMMIT; qualquer erro faz ROLLBACK e é repassado (convertido, se do driver). */
  transaction<T>(fn: (tx: Transacao) => Promise<T>): Promise<T>;
  /** Fecha o pool, esperando as conexões em uso terminarem. */
  encerrar(): Promise<void>;
}

async function comErroConvertido<T>(operacao: () => Promise<T>): Promise<T> {
  try {
    return await operacao();
  } catch (erro: unknown) {
    throw converterErroDoBanco(erro);
  }
}

export function criarBanco(opcoes: OpcoesDoBanco): Banco {
  const pool = new Pool(opcoes.conexao);
  pool.on('error', (erro) => {
    opcoes.aoErroOcioso(converterErroDoBanco(erro));
  });
  const db = drizzle({ client: pool });

  return {
    consultar: (fn) => comErroConvertido(() => fn(db)),
    transaction: (fn) => comErroConvertido(() => db.transaction(fn)),
    encerrar: () => pool.end(),
  };
}
