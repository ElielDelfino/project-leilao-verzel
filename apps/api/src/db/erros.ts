// Conversão dos erros do driver (pg) e do Drizzle antes de saírem de src/db/ (nota da tarefa
// 003, vinda da 022). A `message` do DrizzleQueryError traz o SQL e os parâmetros; o
// DatabaseError do pg pode repetir o valor recebido na `message` ("invalid input syntax for
// type uuid: ...") e no `detail` ("Key (email)=(...) already exists"). O log do 500 grava a
// `message`, o `stack` e as causas, então o erro convertido não guarda nada disso, nem o original
// em `cause`.
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { DatabaseError } from 'pg';

/** Metadados do erro que não carregam valores da consulta: só códigos e nomes do schema. */
export interface DadosDoErroDoBanco {
  /** SQLSTATE do Postgres (ex.: 23505) ou código de sistema da conexão (ex.: ECONNREFUSED). */
  readonly codigo: string | undefined;
  readonly restricao: string | undefined;
  readonly tabela: string | undefined;
  readonly coluna: string | undefined;
}

/** Erro do banco já sem SQL, parâmetros e valores; seguro para o log e para a tradução da API. */
export class ErroDoBanco extends Error {
  override readonly name = 'ErroDoBanco';
  readonly codigo: string | undefined;
  readonly restricao: string | undefined;
  readonly tabela: string | undefined;
  readonly coluna: string | undefined;

  constructor(dados: DadosDoErroDoBanco) {
    super(descrever(dados));
    this.codigo = dados.codigo;
    this.restricao = dados.restricao;
    this.tabela = dados.tabela;
    this.coluna = dados.coluna;
  }
}

function descrever({ codigo, restricao, tabela, coluna }: DadosDoErroDoBanco): string {
  const partes = [
    `código ${codigo ?? 'desconhecido'}`,
    ...(tabela === undefined ? [] : [`tabela ${tabela}`]),
    ...(coluna === undefined ? [] : [`coluna ${coluna}`]),
    ...(restricao === undefined ? [] : [`restrição ${restricao}`]),
  ];
  return `Erro do banco de dados (${partes.join(', ')})`;
}

function dadosDoDatabaseError(erro: DatabaseError): DadosDoErroDoBanco {
  return {
    codigo: erro.code,
    restricao: erro.constraint,
    tabela: erro.table,
    coluna: erro.column,
  };
}

/** Código de sistema de uma falha de conexão (ECONNREFUSED, ETIMEDOUT...), se houver. */
function codigoDeSistema(erro: unknown): string | undefined {
  if (typeof erro === 'object' && erro !== null && 'code' in erro) {
    return typeof erro.code === 'string' ? erro.code : undefined;
  }
  return undefined;
}

const SEM_DETALHES = { restricao: undefined, tabela: undefined, coluna: undefined } as const;

/**
 * Converte um erro do Drizzle ou do pg em ErroDoBanco; qualquer outro erro (de domínio,
 * TransactionRollbackError, ...) volta como está.
 */
export function converterErroDoBanco(erro: unknown): unknown {
  if (erro instanceof ErroDoBanco) {
    return erro;
  }
  if (erro instanceof DatabaseError) {
    return new ErroDoBanco(dadosDoDatabaseError(erro));
  }
  if (erro instanceof DrizzleQueryError) {
    const causa = erro.cause;
    return new ErroDoBanco(
      causa instanceof DatabaseError
        ? dadosDoDatabaseError(causa)
        : { codigo: codigoDeSistema(causa), ...SEM_DETALHES },
    );
  }
  return erro;
}
