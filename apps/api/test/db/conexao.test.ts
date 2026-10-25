// Leitura da conexão com o Postgres em partes (specs/014 §"Conexão da API com Postgres e Redis",
// decisão da tarefa 018): todas obrigatórias, sem default, e o erro cita só os nomes. A senha vem
// de <VAR> xor <VAR>_FILE, na forma canônica (specs/014 §Leitura, tarefa 037).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspect } from 'node:util';

import { afterAll, describe, expect, it } from 'vitest';

import {
  conexaoSeCompleta,
  ErroDeConfiguracaoDoBanco,
  lerConexaoDoBanco,
  trocarBanco,
  VARIAVEIS_DA_API,
} from '../../src/db/conexao.js';
import { ambienteDeTeste } from './ambiente-de-teste.js';

/** Forma canônica (43 caracteres base64url de 32 bytes); não é senha de nenhum serviço. */
const SENHA = Buffer.alloc(32, 0x5a).toString('base64url');
/** 43 caracteres base64url cuja recodificação difere (último caractere com bits extras). */
const SENHA_NAO_CANONICA = `${SENHA.slice(0, 42)}${SENHA.endsWith('B') ? 'C' : 'B'}`;

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

describe('lerConexaoDoBanco: senha de <VAR> xor <VAR>_FILE (specs/014 §Leitura)', () => {
  const pasta = mkdtempSync(join(tmpdir(), 'leilao-t037-'));
  const arquivo = (nome: string, conteudo: string): string => {
    const caminho = join(pasta, nome);
    writeFileSync(caminho, conteudo, { mode: 0o600 });
    return caminho;
  };
  const semSenha = { ...ENV_COMPLETO, DB_PASSWORD: undefined };

  afterAll(() => {
    rmSync(pasta, { recursive: true, force: true });
  });

  function semValores(erro: ErroDeConfiguracaoDoBanco): void {
    expect(erro.message).not.toContain(SENHA);
    expect(erro.message).not.toContain(SENHA_NAO_CANONICA);
    expect(erro.message).not.toContain(pasta);
  }

  it('lê a senha do arquivo de DB_PASSWORD_FILE', () => {
    const conexao = lerConexaoDoBanco({ ...semSenha, DB_PASSWORD_FILE: arquivo('ok', SENHA) });

    expect(conexao.password).toBe(SENHA);
  });

  it('recusa DB_PASSWORD e DB_PASSWORD_FILE juntas, citando as duas', () => {
    const erro = erroDe({ ...ENV_COMPLETO, DB_PASSWORD_FILE: arquivo('juntas', SENHA) });

    expect(erro.variaveis).toEqual(['DB_PASSWORD', 'DB_PASSWORD_FILE']);
    semValores(erro);
  });

  it('recusa nenhuma das duas, citando DB_PASSWORD', () => {
    expect(erroDe(semSenha).variaveis).toEqual(['DB_PASSWORD']);
  });

  it('recusa arquivo ausente ou caminho relativo, citando DB_PASSWORD_FILE', () => {
    const ausente = erroDe({ ...semSenha, DB_PASSWORD_FILE: join(pasta, 'nao-existe') });
    const relativo = erroDe({ ...semSenha, DB_PASSWORD_FILE: 'segredo.txt' });

    for (const erro of [ausente, relativo]) {
      expect(erro.variaveis).toEqual(['DB_PASSWORD_FILE']);
      semValores(erro);
    }
  });

  it('recusa valor fora da forma canônica, na variável ou no arquivo', () => {
    expect(SENHA_NAO_CANONICA).toHaveLength(43);
    const naVariavel = erroDe({ ...ENV_COMPLETO, DB_PASSWORD: SENHA_NAO_CANONICA });
    const comQuebra = erroDe({ ...semSenha, DB_PASSWORD_FILE: arquivo('quebra', `${SENHA}\n`) });
    const curta = erroDe({ ...ENV_COMPLETO, DB_PASSWORD: 'curta' });

    expect(naVariavel.variaveis).toEqual(['DB_PASSWORD']);
    expect(comQuebra.variaveis).toEqual(['DB_PASSWORD_FILE']);
    expect(curta.variaveis).toEqual(['DB_PASSWORD']);
    for (const erro of [naVariavel, comQuebra, curta]) {
      semValores(erro);
    }
  });
});

describe('lerConexaoDoBanco com VARIAVEIS_DA_API (papel da API, D2 da tarefa 036)', () => {
  const ENV_DA_API = {
    POSTGRES_HOST: '127.0.0.1',
    POSTGRES_PORT: '15432',
    POSTGRES_DB: 'leilao',
    POSTGRES_API_USER: 'leilao_api',
    DB_API_PASSWORD: SENHA,
  } as const;

  it('lê POSTGRES_API_USER e DB_API_PASSWORD, ignorando as do dono', () => {
    const conexao = lerConexaoDoBanco(
      { ...ENV_DA_API, POSTGRES_USER: 'leilao', DB_PASSWORD: 'outra' },
      VARIAVEIS_DA_API,
    );

    expect(conexao.user).toBe('leilao_api');
    expect(conexao.password).toBe(SENHA);
  });

  it('cita os nomes da API quando faltam', () => {
    let erro: unknown;
    try {
      lerConexaoDoBanco(
        { ...ENV_DA_API, POSTGRES_API_USER: undefined, DB_API_PASSWORD: undefined },
        VARIAVEIS_DA_API,
      );
    } catch (e: unknown) {
      erro = e;
    }

    expect(erro).toEqual(new ErroDeConfiguracaoDoBanco(['POSTGRES_API_USER', 'DB_API_PASSWORD']));
    expect(
      conexaoSeCompleta({ ...ENV_DA_API, DB_API_PASSWORD: 'x' }, VARIAVEIS_DA_API),
    ).toBeUndefined();
  });
});
