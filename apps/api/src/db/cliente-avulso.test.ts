// Unidade: conexão avulsa dos scripts de banco (cliente falso, sem Postgres).
import { EventEmitter } from 'node:events';

import { DrizzleQueryError } from 'drizzle-orm/errors';
import { describe, expect, it } from 'vitest';

import {
  causaParaExibir,
  type ClienteAvulso,
  comClienteAvulso,
  SEM_CAUSA,
} from './cliente-avulso.js';
import { lerConexaoDoBanco } from './conexao.js';

const CONEXAO = lerConexaoDoBanco({
  POSTGRES_HOST: 'h',
  POSTGRES_PORT: '1',
  POSTGRES_DB: 'd',
  POSTGRES_USER: 'u',
  DB_PASSWORD: 'p',
});

interface Comportamento {
  readonly falhaAoConectar?: Error;
  readonly falhaAoFechar?: Error;
}

class ClienteFalso extends EventEmitter implements ClienteAvulso {
  fechado = 0;
  constructor(private readonly comportamento: Comportamento = {}) {
    super();
  }
  connect(): Promise<void> {
    return this.comportamento.falhaAoConectar
      ? Promise.reject(this.comportamento.falhaAoConectar)
      : Promise.resolve();
  }
  end(): Promise<void> {
    this.fechado += 1;
    return this.comportamento.falhaAoFechar
      ? Promise.reject(this.comportamento.falhaAoFechar)
      : Promise.resolve();
  }
}

describe('comClienteAvulso', () => {
  it('conecta, executa, fecha e devolve o resultado', async () => {
    const cliente = new ClienteFalso();

    const resultado = await comClienteAvulso(
      CONEXAO,
      () => Promise.resolve(42),
      () => cliente,
    );

    expect(resultado).toBe(42);
    expect(cliente.fechado).toBe(1);
  });

  it('falha ao conectar: fecha e repassa o erro da conexão', async () => {
    const falha = new Error('ECONNREFUSED');
    const cliente = new ClienteFalso({ falhaAoConectar: falha });

    await expect(
      comClienteAvulso(
        CONEXAO,
        () => Promise.resolve(1),
        () => cliente,
      ),
    ).rejects.toBe(falha);
    expect(cliente.fechado).toBe(1);
  });

  it('o erro do fechamento não mascara o erro do trabalho', async () => {
    const trabalho = new Error('trabalho');
    const cliente = new ClienteFalso({ falhaAoFechar: new Error('fechar') });

    await expect(
      comClienteAvulso(
        CONEXAO,
        () => Promise.reject(trabalho),
        () => cliente,
      ),
    ).rejects.toBe(trabalho);
  });

  it("um 'error' da conexão não derruba o processo e vira rejeição", async () => {
    const queda = new Error('Connection terminated unexpectedly');
    const cliente = new ClienteFalso();

    const promessa = comClienteAvulso(
      CONEXAO,
      (c) => {
        c.emit('error', queda);
        return Promise.resolve('ok');
      },
      () => cliente,
    );

    await expect(promessa).rejects.toBe(queda);
  });
});

describe('causaParaExibir', () => {
  it('desembrulha DrizzleQueryError e AggregateError', () => {
    const raiz = new Error('connect ECONNREFUSED 127.0.0.1:15432');
    const agregado = new AggregateError([raiz], '');

    expect(causaParaExibir(new DrizzleQueryError('select', ['x'], agregado))).toBe(raiz);
    expect(causaParaExibir(agregado)).toBe(raiz);
    expect(causaParaExibir(raiz)).toBe(raiz);
  });

  it('DrizzleQueryError sem causa vira SEM_CAUSA (a mensagem dele tem SQL e parâmetros)', () => {
    expect(causaParaExibir(new DrizzleQueryError('select $1', ['segredo']))).toBe(SEM_CAUSA);
  });
});
