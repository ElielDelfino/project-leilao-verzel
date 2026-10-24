// Leitura da conexão com o Postgres em partes (specs/014 §"Conexão da API com Postgres e Redis",
// decisão da tarefa 018): todas obrigatórias, sem default, e o erro cita só os nomes.
import { describe, expect, it } from 'vitest';

import { ErroDeConfiguracao } from '../config/env.js';
import { lerConexaoDoBanco } from './conexao.js';

const SENHA = 'senha-que-nao-pode-aparecer';

const ENV_COMPLETO = {
  POSTGRES_HOST: '127.0.0.1',
  POSTGRES_PORT: '15432',
  POSTGRES_DB: 'leilao',
  POSTGRES_USER: 'leilao',
  DB_PASSWORD: SENHA,
} as const;

function erroDe(env: Readonly<Record<string, string | undefined>>): ErroDeConfiguracao {
  try {
    lerConexaoDoBanco(env);
  } catch (erro: unknown) {
    if (erro instanceof ErroDeConfiguracao) {
      return erro;
    }
    throw erro;
  }
  throw new Error('deveria ter falhado');
}

describe('lerConexaoDoBanco', () => {
  it('monta a conexão a partir das cinco variáveis', () => {
    expect(lerConexaoDoBanco(ENV_COMPLETO)).toEqual({
      host: '127.0.0.1',
      port: 15432,
      database: 'leilao',
      user: 'leilao',
      password: SENHA,
    });
  });

  it('ignora variáveis que não são de conexão (DATABASE_URL não é usada)', () => {
    const conexao = lerConexaoDoBanco({ ...ENV_COMPLETO, DATABASE_URL: 'postgres://x@y/z' });

    expect(conexao.host).toBe('127.0.0.1');
    expect(Object.keys(conexao).sort()).toEqual(['database', 'host', 'password', 'port', 'user']);
  });

  it.each(['POSTGRES_HOST', 'POSTGRES_PORT', 'POSTGRES_DB', 'POSTGRES_USER', 'DB_PASSWORD'])(
    'recusa %s ausente ou vazia, citando só o nome',
    (nome) => {
      const semAVariavel = erroDe({ ...ENV_COMPLETO, [nome]: undefined });
      const vazia = erroDe({ ...ENV_COMPLETO, [nome]: '' });

      for (const erro of [semAVariavel, vazia]) {
        expect(erro.message).toContain(nome);
        expect(erro.message).not.toContain(SENHA);
        expect(erro.message).not.toContain('127.0.0.1');
      }
    },
  );

  it('lista todas as variáveis que faltam', () => {
    expect(erroDe({}).message).toBe(
      'Conexão com o Postgres: variáveis ausentes ou inválidas: ' +
        'POSTGRES_HOST, POSTGRES_PORT, POSTGRES_DB, POSTGRES_USER, DB_PASSWORD',
    );
  });

  it.each(['0', '65536', '15432x', '1.5', '-1'])(
    'recusa POSTGRES_PORT=%s sem exibir o valor',
    (porta) => {
      const erro = erroDe({ ...ENV_COMPLETO, POSTGRES_PORT: porta });

      expect(erro.message).toBe(
        'Conexão com o Postgres: variáveis ausentes ou inválidas: POSTGRES_PORT',
      );
    },
  );
});
