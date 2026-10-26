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
 * SQLSTATE sintético (classe 08, connection_exception) para falhas de conexão que o pg e o
 * pg-pool lançam sem `code`: não foi possível obter uma conexão (pool saturado ou handshake
 * acima do connectionTimeoutMillis). Mesmo valor de sqlclient_unable_to_establish_sqlconnection.
 */
export const SQLSTATE_SEM_CONEXAO = '08001';
/** SQLSTATE sintético (connection_failure) para a conexão que caiu no meio do caminho. */
export const SQLSTATE_CONEXAO_PERDIDA = '08006';

/**
 * Mensagens exatas, sem `code`, de pg 8.23 (lib/client.js) e pg-pool 3.14 (index.js). Só valem
 * num `Error` puro (protótipo Error.prototype): um erro de domínio com o mesmo texto não muda.
 */
const MENSAGENS_DE_CONEXAO: ReadonlyMap<string, string> = new Map([
  ['timeout exceeded when trying to connect', SQLSTATE_SEM_CONEXAO],
  ['Connection terminated due to connection timeout', SQLSTATE_SEM_CONEXAO],
  ['timeout expired', SQLSTATE_SEM_CONEXAO],
  ['Connection terminated unexpectedly', SQLSTATE_CONEXAO_PERDIDA],
  // Consulta (como o ROLLBACK do Drizzle) num cliente cuja conexão já caiu ou foi fechada.
  ['Client has encountered a connection error and is not queryable', SQLSTATE_CONEXAO_PERDIDA],
  ['Client was closed and is not queryable', SQLSTATE_CONEXAO_PERDIDA],
]);

/**
 * Chamadas de sistema de uma conexão com o Postgres (TCP ou socket Unix). Um erro com uma delas
 * em `syscall` e um `code` string é falha de conexão, qualquer que seja o código (ECONNREFUSED,
 * ENOENT do socket Unix inexistente, EACCES, EMFILE, ENETRESET...): a mensagem dele traz o
 * endereço, a porta ou o caminho do socket. ENOENT de `open` e afins não entram.
 */
const CHAMADAS_DE_CONEXAO: ReadonlySet<string> = new Set([
  'connect',
  'getaddrinfo',
  'read',
  'write',
]);

/** Formato de código de sistema; outro valor em `code` não vai para o ErroDoBanco. */
const CODIGO_DE_SISTEMA = /^[A-Z0-9_]{1,64}$/;

function textoDe(erro: object, campo: 'code' | 'syscall'): string | undefined {
  try {
    const valor: unknown = (erro as Record<string, unknown>)[campo];
    return typeof valor === 'string' ? valor : undefined;
  } catch {
    return undefined;
  }
}

/** O código que vai para o ErroDoBanco: o `code` se tiver o formato, senão o SQLSTATE 08001. */
function codigoSeguro(codigo: string): string {
  return CODIGO_DE_SISTEMA.test(codigo) ? codigo : SQLSTATE_SEM_CONEXAO;
}

/**
 * Erro de socket do Node (ou objeto com a mesma forma, numa `cause`): `syscall` de conexão e
 * `code` string.
 */
function codigoDeErroDeSocket(erro: object): string | undefined {
  const codigo = textoDe(erro, 'code');
  const chamada = textoDe(erro, 'syscall');
  return codigo !== undefined && chamada !== undefined && CHAMADAS_DE_CONEXAO.has(chamada)
    ? codigoSeguro(codigo)
    : undefined;
}

/**
 * AggregateError do `net` com autoSelectFamily (host com IPv4 e IPv6, como `localhost`): tem
 * `code` do primeiro filho e nenhum `syscall`. Basta um filho ser falha de conexão para o
 * agregado inteiro virar ErroDoBanco: os outros filhos (e a mensagem) também podem ter o
 * endereço e são descartados com ele.
 */
function codigoDeAgregadoDeRede(erro: AggregateError): string | undefined {
  const filhos: unknown[] = Array.isArray(erro.errors) ? erro.errors : [];
  const codigoDoFilho = filhos
    .map((filho) => codigoDaFalhaDeConexao(filho))
    .find((codigo) => codigo !== undefined);
  if (codigoDoFilho === undefined) {
    return undefined;
  }
  const proprio = textoDe(erro, 'code');
  return proprio !== undefined && CODIGO_DE_SISTEMA.test(proprio) ? proprio : codigoDoFilho;
}

/**
 * Código de uma falha de conexão crua (fora do Drizzle, como a do `pool.connect()` no BEGIN de
 * `db.transaction`): o código de sistema ou um SQLSTATE sintético da classe 08. `undefined` para
 * qualquer outro erro ou valor (TypeError, erro de domínio, texto...).
 */
function codigoDaFalhaDeConexao(erro: unknown): string | undefined {
  if (erro instanceof AggregateError) {
    return codigoDeAgregadoDeRede(erro);
  }
  if (typeof erro !== 'object' || erro === null) {
    return undefined;
  }
  if (
    erro instanceof Error &&
    Object.getPrototypeOf(erro) === Error.prototype &&
    textoDe(erro, 'code') === undefined
  ) {
    const sintetico = MENSAGENS_DE_CONEXAO.get(erro.message);
    if (sintetico !== undefined) {
      return sintetico;
    }
  }
  return codigoDeErroDeSocket(erro);
}

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
      : { codigo: codigoDaFalhaDeConexao(causa) ?? codigoDeSistema(causa), ...SEM_DETALHES },
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
  const codigoDeConexao = codigoDaFalhaDeConexao(erro);
  if (codigoDeConexao !== undefined) {
    return new ErroDoBanco({ codigo: codigoDeConexao, ...SEM_DETALHES });
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
 * mensagem, stack e campos) com a causa convertida. Falhas de conexão cruas (erro de socket com
 * `code` e `syscall` de conexão, mesmo como objeto numa `cause`; AggregateError com algum filho
 * assim; mensagens sem `code` do pg e do pg-pool) também viram ErroDoBanco, sem endereço, porta,
 * `errors` nem `cause`. O original nunca é alterado. Um erro sem
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
