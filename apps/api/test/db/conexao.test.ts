// Leitura da conexão com o Postgres em partes (specs/014 §"Conexão da API com Postgres e Redis",
// decisão da tarefa 018): todas obrigatórias, sem default, e o erro cita só os nomes.
import { inspect } from 'node:util';

import { describe, expect, it } from 'vitest';

import {
  conexaoSeCompleta,
  ErroDeConfiguracaoDoBanco,
  lerConexaoDoBanco,
  trocarBanco,
} from '../../src/db/conexao.js';
import { ambienteDeTeste } from './ambiente-de-teste.js';

const SENHA = 'senha-que-nao-pode-aparecer';

const ENV_COMPLETO = {
  POSTGRES_HOST: '127.0.0.1',
  POSTGRES_PORT: '15432',
  POSTGRES_DB: 'leilao',
  POSTGRES_USER: 'leilao',
  DB_PASSWORD: SENHA,
} as const;

function erroDe(env: Readonly<Record<string, string | undefined>>): ErroDeConfiguracaoDoBanco {
  try {
    lerConexaoDoBanco(env);
  } catch (erro: unknown) {
    if (erro instanceof ErroDeConfiguracaoDoBanco) {
      return erro;
    }
    throw erro;
  }
  throw new Error('deveria ter falhado');
}

describe('lerConexaoDoBanco', () => {
  it('monta a conexão a partir das cinco variáveis', () => {
    const conexao = lerConexaoDoBanco(ENV_COMPLETO);

    expect(conexao.host).toBe('127.0.0.1');
    expect(conexao.port).toBe(15432);
    expect(conexao.database).toBe('leilao');
    expect(conexao.user).toBe('leilao');
    expect(conexao.password).toBe(SENHA);
  });

  it('esconde a senha de JSON.stringify, Object.keys, spread e util.inspect', () => {
    const conexao = lerConexaoDoBanco(ENV_COMPLETO);

    expect(JSON.stringify(conexao)).not.toContain(SENHA);
    expect(Object.keys(conexao).sort()).toEqual(['database', 'host', 'port', 'user']);
    expect(JSON.stringify({ ...conexao })).not.toContain(SENHA);
    expect(inspect(conexao)).not.toContain(SENHA);
  });

  it('ignora variáveis que não são de conexão (DATABASE_URL não é usada)', () => {
    const conexao = lerConexaoDoBanco({ ...ENV_COMPLETO, DATABASE_URL: 'postgres://x@y/z' });

    expect(conexao.host).toBe('127.0.0.1');
  });

  it.each(['POSTGRES_HOST', 'POSTGRES_PORT', 'POSTGRES_DB', 'POSTGRES_USER', 'DB_PASSWORD'])(
    'recusa %s ausente ou vazia, citando só o nome',
    (nome) => {
      const semAVariavel = erroDe({ ...ENV_COMPLETO, [nome]: undefined });
      const vazia = erroDe({ ...ENV_COMPLETO, [nome]: '' });

      for (const erro of [semAVariavel, vazia]) {
        expect(erro.name).toBe('ErroDeConfiguracaoDoBanco');
        expect(erro.variaveis).toEqual([nome]);
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

describe('conexaoSeCompleta', () => {
  it('devolve a conexão quando as cinco variáveis estão válidas', () => {
    expect(conexaoSeCompleta(ENV_COMPLETO)?.password).toBe(SENHA);
  });

  it('devolve undefined, sem lançar, quando falta ou é inválida alguma', () => {
    expect(conexaoSeCompleta({})).toBeUndefined();
    expect(conexaoSeCompleta({ ...ENV_COMPLETO, POSTGRES_HOST: undefined })).toBeUndefined();
    expect(conexaoSeCompleta({ ...ENV_COMPLETO, POSTGRES_PORT: 'x' })).toBeUndefined();
  });
});

describe('ambienteDeTeste', () => {
  it('sem LEILAO_TEST_DB e sem variáveis: indisponível (testes de banco pulados)', () => {
    const ambiente = ambienteDeTeste({});

    expect(ambiente.disponivel).toBe(false);
    expect(() => ambiente.conexao()).toThrow('describe.skipIf');
  });

  it('com LEILAO_TEST_DB e sem variáveis: falha já na coleta, citando os nomes', () => {
    expect(() =>
      ambienteDeTeste({ LEILAO_TEST_DB: 'local', ...ENV_COMPLETO, DB_PASSWORD: '' }),
    ).toThrow(new ErroDeConfiguracaoDoBanco(['DB_PASSWORD']));
  });

  it('com as variáveis: disponível, com ou sem LEILAO_TEST_DB', () => {
    expect(ambienteDeTeste(ENV_COMPLETO).conexao().password).toBe(SENHA);
    expect(ambienteDeTeste({ ...ENV_COMPLETO, LEILAO_TEST_DB: 'local' }).disponivel).toBe(true);
  });
});

describe('trocarBanco', () => {
  it('troca só o banco e mantém a senha (escondida)', () => {
    const original = lerConexaoDoBanco(ENV_COMPLETO);

    const outra = trocarBanco(original, 'leilao_test');

    expect(outra.database).toBe('leilao_test');
    expect(outra.host).toBe(original.host);
    expect(outra.password).toBe(SENHA);
    expect(JSON.stringify(outra)).not.toContain(SENHA);
    expect(original.database).toBe('leilao');
  });
});
