// Uma conexão `pg` avulsa (sem pool) para os scripts de banco: db:migrate e db:seed. Cuida do
// que o pg.Client sozinho não faz (revisões da tarefa 003):
// - listener de 'error': sem ele, a queda da conexão vira exceção não capturada;
// - connect() dentro do try: falhar ao conectar também passa pelo fechamento;
// - falha no end() não mascara o erro original do trabalho.
import { DrizzleQueryError } from 'drizzle-orm/errors';
import pg from 'pg';

import type { ConexaoDoBanco } from './conexao.js';

/** O que este módulo usa do pg.Client (permite um cliente falso nos testes). */
export interface ClienteAvulso {
  connect(): Promise<unknown>;
  end(): Promise<unknown>;
  on(evento: 'error', listener: (erro: Error) => void): unknown;
}

/** Abre a conexão, executa `fn` e fecha. Erro da conexão fora de consulta vira rejeição. */
export async function comClienteAvulso<C extends ClienteAvulso, T>(
  conexao: ConexaoDoBanco,
  fn: (cliente: C) => Promise<T>,
  criar: (conexao: ConexaoDoBanco) => C,
): Promise<T> {
  const cliente = criar(conexao);
  let erroDaConexao: Error | undefined;
  cliente.on('error', (erro) => {
    erroDaConexao ??= erro;
  });

  let resultado: T;
  try {
    await cliente.connect();
    resultado = await fn(cliente);
  } catch (erro: unknown) {
    try {
      await cliente.end();
    } catch {
      // O erro do trabalho é o que importa; o do fechamento não pode escondê-lo.
    }
    throw erro;
  }
  await cliente.end();
  if (erroDaConexao !== undefined) {
    throw erroDaConexao;
  }
  return resultado;
}

/** Fábrica padrão: um pg.Client real. */
export function criarClientePg(conexao: ConexaoDoBanco): pg.Client {
  return new pg.Client(conexao);
}

const PROFUNDIDADE_MAXIMA = 5;

/** Marcador de DrizzleQueryError sem causa: a mensagem dele (SQL e parâmetros) nunca é exibida. */
export const SEM_CAUSA = Symbol('DrizzleQueryError sem causa');

/**
 * A causa útil para exibir no terminal: desembrulha DrizzleQueryError (pela `cause`; a mensagem
 * dele nunca é usada) e AggregateError (o primeiro de `errors`: o `connect` do Node junta as
 * tentativas IPv4/IPv6 num AggregateError de mensagem vazia).
 */
export function causaParaExibir(erro: unknown): unknown {
  let atual: unknown = erro;
  for (let i = 0; i < PROFUNDIDADE_MAXIMA; i++) {
    if (atual instanceof DrizzleQueryError) {
      atual = atual.cause ?? SEM_CAUSA;
    } else if (atual instanceof AggregateError && atual.errors.length > 0) {
      atual = atual.errors[0];
    } else {
      return atual;
    }
  }
  return atual instanceof DrizzleQueryError ? SEM_CAUSA : atual;
}
