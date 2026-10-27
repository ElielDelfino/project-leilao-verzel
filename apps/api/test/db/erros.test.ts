// Conversão dos erros do driver e do Drizzle (nota da tarefa 003, vinda da 022): o erro que sai
// de src/db/ não pode levar SQL, parâmetros nem `detail` do pg para o log.
import { DrizzleQueryError, TransactionRollbackError } from 'drizzle-orm/errors';
import { DatabaseError } from 'pg';
import { describe, expect, it } from 'vitest';

import { converterErroDoBanco, ErroDoBanco, paraErroDoBanco } from '../../src/db/erros.js';
import { serializarErro } from '../../src/logger/logger.js';

const EMAIL = 'helena@demo.local';
const CONSULTA = 'insert into "users" ("email") values ($1)';

function violacaoDeUnicidade(): DatabaseError {
  const erro = new DatabaseError(
    'duplicate key value violates unique constraint "users_email_key"',
    0,
    'error',
  );
  erro.code = '23505';
  erro.detail = `Key (email)=(${EMAIL}) already exists.`;
  erro.constraint = 'users_email_key';
  erro.table = 'users';
  erro.schema = 'public';
  return erro;
}

function entradaInvalida(): DatabaseError {
  // O pg repete o valor recebido na própria mensagem deste erro.
  const erro = new DatabaseError(`invalid input syntax for type uuid: "${EMAIL}"`, 0, 'error');
  erro.code = '22P02';
  return erro;
}

describe('converterErroDoBanco', () => {
  it('converte o DrizzleQueryError sem SQL, parâmetros nem detail', () => {
    const original = new DrizzleQueryError(CONSULTA, [EMAIL], violacaoDeUnicidade());

    const convertido = converterErroDoBanco(original);

    expect(convertido).toBeInstanceOf(ErroDoBanco);
    const erro = convertido as ErroDoBanco;
    expect(erro.codigo).toBe('23505');
    expect(erro.restricao).toBe('users_email_key');
    expect(erro.tabela).toBe('users');
    expect(erro.message).not.toContain(EMAIL);
    expect(erro.message).not.toContain('insert into');
    expect(erro.cause).toBeUndefined();
  });

  it('converte o DatabaseError do pg mesmo fora do Drizzle', () => {
    const convertido = converterErroDoBanco(entradaInvalida());

    expect(convertido).toBeInstanceOf(ErroDoBanco);
    expect((convertido as ErroDoBanco).codigo).toBe('22P02');
    expect((convertido as ErroDoBanco).message).not.toContain(EMAIL);
  });

  it('converte falha de conexão embrulhada pelo Drizzle mantendo só o código do sistema', () => {
    const falha = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:15432'), {
      code: 'ECONNREFUSED',
    });
    const original = new DrizzleQueryError(CONSULTA, [EMAIL], falha);

    const convertido = converterErroDoBanco(original) as ErroDoBanco;

    expect(convertido).toBeInstanceOf(ErroDoBanco);
    expect(convertido.codigo).toBe('ECONNREFUSED');
    expect(convertido.message).not.toContain(EMAIL);
  });

  it('converte o DrizzleQueryError sem causa conhecida com código indefinido', () => {
    const convertido = converterErroDoBanco(
      new DrizzleQueryError(CONSULTA, [EMAIL]),
    ) as ErroDoBanco;

    expect(convertido).toBeInstanceOf(ErroDoBanco);
    expect(convertido.codigo).toBeUndefined();
    expect(convertido.message).not.toContain(EMAIL);
  });

  it('não altera erros que não vêm do driver', () => {
    const dominio = new Error('regra de negócio');
    const rollback = new TransactionRollbackError();

    expect(converterErroDoBanco(dominio)).toBe(dominio);
    expect(converterErroDoBanco(rollback)).toBe(rollback);
    expect(converterErroDoBanco('texto')).toBe('texto');
  });

  it('o erro convertido, serializado para o log, não contém valores da consulta', () => {
    const original = new DrizzleQueryError(CONSULTA, [EMAIL], violacaoDeUnicidade());

    const linhaDeLog = JSON.stringify(serializarErro(converterErroDoBanco(original)));

    expect(linhaDeLog).not.toContain(EMAIL);
    expect(linhaDeLog).not.toContain('insert into');
    expect(linhaDeLog).toContain('23505');
  });
});

class ErroDeDominio extends Error {
  override readonly name = 'ErroDeDominio';
  readonly codigoDeDominio = 'EMAIL_EM_USO';
}

function semValoresDaConsulta(texto: string): void {
  expect(texto).not.toContain(EMAIL);
  expect(texto).not.toContain('insert into');
  expect(texto).not.toContain('Failed query');
}

describe('converterErroDoBanco na cadeia de cause', () => {
  it('troca o DrizzleQueryError na cause por ErroDoBanco, numa cópia do erro de domínio', () => {
    const causa = new DrizzleQueryError(CONSULTA, [EMAIL], violacaoDeUnicidade());
    const original = new ErroDeDominio('e-mail já cadastrado', { cause: causa });

    const convertido = converterErroDoBanco(original) as ErroDeDominio;

    expect(convertido).not.toBe(original);
    expect(convertido).toBeInstanceOf(ErroDeDominio);
    expect(convertido.name).toBe('ErroDeDominio');
    expect(convertido.message).toBe('e-mail já cadastrado');
    expect(convertido.codigoDeDominio).toBe('EMAIL_EM_USO');
    expect(convertido.stack).toBe(original.stack);
    expect(convertido.cause).toBeInstanceOf(ErroDoBanco);
    expect((convertido.cause as ErroDoBanco).restricao).toBe('users_email_key');
    // O original não muda.
    expect(original.cause).toBe(causa);
    semValoresDaConsulta(convertido.message);
    semValoresDaConsulta(convertido.stack ?? '');
    semValoresDaConsulta(JSON.stringify(convertido));
    semValoresDaConsulta(JSON.stringify(serializarErro(convertido)));
  });

  it('percorre causas aninhadas e o DatabaseError cru', () => {
    const meio = new Error('falha ao cadastrar', { cause: violacaoDeUnicidade() });
    const topo = new ErroDeDominio('cadastro recusado', { cause: meio });

    const convertido = converterErroDoBanco(topo) as ErroDeDominio;

    const convertidoMeio = convertido.cause as Error;
    expect(convertidoMeio).not.toBe(meio);
    expect(convertidoMeio.message).toBe('falha ao cadastrar');
    expect(convertidoMeio.cause).toBeInstanceOf(ErroDoBanco);
    semValoresDaConsulta(JSON.stringify(serializarErro(convertido)));
    expect(JSON.stringify(serializarErro(convertido))).not.toContain('already exists');
  });

  it('devolve o mesmo erro quando a cadeia não tem erro do banco', () => {
    const original = new ErroDeDominio('saldo', { cause: new Error('interno') });

    expect(converterErroDoBanco(original)).toBe(original);
  });

  it('paraErroDoBanco transforma falha de conexão crua em ErroDoBanco só com o código', () => {
    const falha = Object.assign(new Error('Connection terminated unexpectedly'), {
      code: 'ECONNRESET',
      client: { senha: EMAIL },
    });

    const convertido = paraErroDoBanco(falha);

    expect(convertido).toBeInstanceOf(ErroDoBanco);
    expect(convertido.codigo).toBe('ECONNRESET');
    expect(JSON.stringify(serializarErro(convertido))).not.toContain(EMAIL);
    expect(paraErroDoBanco(violacaoDeUnicidade()).codigo).toBe('23505');
  });

  it('não entra em laço com cause circular', () => {
    const a = new Error('a');
    const b = new Error('b', { cause: a });
    Object.defineProperty(a, 'cause', { value: b, enumerable: false, configurable: true });

    expect(converterErroDoBanco(b)).toBe(b);
  });
});
