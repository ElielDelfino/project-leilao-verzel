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

/** Erro que o driver ou o Drizzle produziu e que precisa virar ErroDoBanco. */
function ehErroDoDriver(erro: unknown): erro is DatabaseError | DrizzleQueryError {
  return erro instanceof DatabaseError || erro instanceof DrizzleQueryError;
}

function converterErroDoDriver(erro: DatabaseError | DrizzleQueryError): ErroDoBanco {
  if (erro instanceof DatabaseError) {
    return new ErroDoBanco(dadosDoDatabaseError(erro));
  }
  const causa = erro.cause;
  return new ErroDoBanco(
    causa instanceof DatabaseError
      ? dadosDoDatabaseError(causa)
      : { codigo: codigoDeSistema(causa), ...SEM_DETALHES },
  );
}

/** Cópia do erro (mesmo protótipo e propriedades próprias) com outra `cause`. */
function copiaComCausa(erro: Error, causa: unknown): Error {
  const copia = Object.create(Object.getPrototypeOf(erro) as object) as Error;
  Object.defineProperties(copia, Object.getOwnPropertyDescriptors(erro));
  // O V8 pode guardar o stack como acessor ligado ao objeto original: copia o valor.
  if (Object.hasOwn(erro, 'stack')) {
    Object.defineProperty(copia, 'stack', {
      value: erro.stack,
      enumerable: false,
      writable: true,
      configurable: true,
    });
  }
  Object.defineProperty(copia, 'cause', {
    value: causa,
    enumerable: Object.getOwnPropertyDescriptor(erro, 'cause')?.enumerable ?? false,
    writable: true,
    configurable: true,
  });
  return copia;
}

function converterCadeia(erro: unknown, vistos: WeakSet<object>): unknown {
  if (ehErroDoDriver(erro)) {
    return converterErroDoDriver(erro);
  }
  if (!(erro instanceof Error) || erro instanceof ErroDoBanco || vistos.has(erro)) {
    return erro;
  }
  vistos.add(erro);
  if (!('cause' in erro)) {
    return erro;
  }
  const causa = converterCadeia(erro.cause, vistos);
  return causa === erro.cause ? erro : copiaComCausa(erro, causa);
}

/**
 * Converte erros do Drizzle (DrizzleQueryError, com SQL e parâmetros na mensagem) e do pg
 * (DatabaseError, com valores na mensagem e no `detail`) em ErroDoBanco, também na cadeia de
 * `cause`: um erro de domínio que embrulha um erro do driver volta como uma cópia (mesma classe,
 * mensagem, stack e campos) com a causa convertida. O original nunca é alterado. Um erro sem
 * nada a converter (de domínio, TransactionRollbackError, ...) volta como está, o mesmo objeto.
 */
export function converterErroDoBanco(erro: unknown): unknown {
  return converterCadeia(erro, new WeakSet());
}

/**
 * Para falhas de conexão (eventos 'error' do pg): sempre um ErroDoBanco, só com o código. O
 * erro cru do pg-pool leva o próprio Client em `err.client`, que não deve chegar ao log.
 */
export function paraErroDoBanco(erro: unknown): ErroDoBanco {
  const convertido = converterErroDoBanco(erro);
  return convertido instanceof ErroDoBanco
    ? convertido
    : new ErroDoBanco({ codigo: codigoDeSistema(erro), ...SEM_DETALHES });
}
