import { randomBytes } from 'node:crypto';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { carregarEnv, ErroDeConfiguracao } from '../../src/config/env.js';

/** Segredo na forma canônica de specs/014 §Leitura: 32 bytes em base64url sem padding. */
function segredo(): string {
  return randomBytes(32).toString('base64url');
}

const CONEXAO = {
  POSTGRES_HOST: '127.0.0.1',
  POSTGRES_PORT: '15432',
  POSTGRES_DB: 'leilao',
  POSTGRES_USER: 'leilao',
  REDIS_HOST: '127.0.0.1',
  REDIS_PORT: '16379',
} as const;

function envValido(
  extra: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    API_PORT: '13000',
    ...CONEXAO,
    DB_PASSWORD: segredo(),
    REDIS_PASSWORD: segredo(),
    ...extra,
  };
}

function mensagemDe(fn: () => unknown): string {
  try {
    fn();
  } catch (erro) {
    expect(erro).toBeInstanceOf(ErroDeConfiguracao);
    return erro instanceof Error ? erro.message : String(erro);
  }
  throw new Error('carregarEnv deveria ter lançado');
}

describe('carregarEnv (validação do env no boot)', () => {
  it('aceita um env válido e converte as portas para número', () => {
    const env = carregarEnv(envValido({ LOG_LEVEL: 'warn' }));

    expect(env.API_PORT).toBe(13000);
    expect(env.LOG_LEVEL).toBe('warn');
    expect(env.postgres).toMatchObject({
      host: '127.0.0.1',
      port: 15432,
      database: 'leilao',
      user: 'leilao',
    });
    expect(env.redis).toMatchObject({ host: '127.0.0.1', port: 16379 });
  });

  it('usa LOG_LEVEL=info quando ausente', () => {
    const env = carregarEnv(envValido());

    expect(env.LOG_LEVEL).toBe('info');
  });

  it('ignora variáveis que não estão no esquema', () => {
    const env = carregarEnv(envValido({ OUTRA: 'x' }));

    expect(env).not.toHaveProperty('OUTRA');
  });

  it('falha rápido quando API_PORT está ausente, citando o nome da variável', () => {
    expect(mensagemDe(() => carregarEnv(envValido({ API_PORT: undefined })))).toMatch(/API_PORT/);
  });

  it.each(['0', '65536', '13000.5', 'abc', ''])('recusa API_PORT=%j', (valor) => {
    expect(() => carregarEnv(envValido({ API_PORT: valor }))).toThrow(ErroDeConfiguracao);
  });

  it('recusa LOG_LEVEL fora da lista do Pino', () => {
    expect(() => carregarEnv(envValido({ LOG_LEVEL: 'barulhento' }))).toThrow(/LOG_LEVEL/);
  });

  it('não vaza o valor recebido na mensagem de erro', () => {
    const valorSensivel = 'segredo-que-nao-pode-aparecer-123';

    const mensagem = mensagemDe(() =>
      carregarEnv(envValido({ API_PORT: valorSensivel, LOG_LEVEL: valorSensivel })),
    );

    expect(mensagem).toMatch(/API_PORT/);
    expect(mensagem).toMatch(/LOG_LEVEL/);
    expect(mensagem).not.toContain(valorSensivel);
  });
});

// specs/014 §Conexão da API com Postgres e Redis: as 8 variáveis são obrigatórias e sem default.
describe('carregarEnv: conexão com Postgres e Redis (specs/014 §Conexão)', () => {
  it.each([
    'POSTGRES_HOST',
    'POSTGRES_PORT',
    'POSTGRES_DB',
    'POSTGRES_USER',
    'REDIS_HOST',
    'REDIS_PORT',
  ])('não sobe sem %s e a mensagem cita só o nome', (nome) => {
    const mensagem = mensagemDe(() => carregarEnv(envValido({ [nome]: undefined })));

    expect(mensagem).toContain(nome);
  });

  it.each(['POSTGRES_HOST', 'POSTGRES_DB', 'POSTGRES_USER', 'REDIS_HOST'])(
    'recusa %s vazio',
    (nome) => {
      expect(mensagemDe(() => carregarEnv(envValido({ [nome]: '' })))).toContain(nome);
    },
  );

  it.each(['0', '65536', '15432.5', 'abc', '', ' 15432', '1e3'])(
    'recusa POSTGRES_PORT e REDIS_PORT = %j',
    (valor) => {
      const mensagem = mensagemDe(() =>
        carregarEnv(envValido({ POSTGRES_PORT: valor, REDIS_PORT: valor })),
      );

      expect(mensagem).toContain('POSTGRES_PORT');
      expect(mensagem).toContain('REDIS_PORT');
    },
  );

  it.each(['DB_PASSWORD', 'REDIS_PASSWORD'])(
    'não sobe sem %s nem %s_FILE e a mensagem cita os dois nomes',
    (nome) => {
      const mensagem = mensagemDe(() => carregarEnv(envValido({ [nome]: undefined })));

      expect(mensagem).toContain(nome);
      expect(mensagem).toContain(`${nome}_FILE`);
    },
  );

  it('não aceita DATABASE_URL nem REDIS_URL no lugar das partes', () => {
    const mensagem = mensagemDe(() =>
      carregarEnv({
        API_PORT: '13000',
        DATABASE_URL: 'postgres://leilao:x@127.0.0.1:15432/leilao',
        REDIS_URL: 'redis://:x@127.0.0.1:16379',
      }),
    );

    expect(mensagem).toContain('POSTGRES_HOST');
    expect(mensagem).toContain('REDIS_HOST');
    expect(mensagem).not.toContain('postgres://');
  });

  it('acumula todos os problemas numa única mensagem', () => {
    const mensagem = mensagemDe(() => carregarEnv({ API_PORT: '13000' }));

    for (const nome of [
      'POSTGRES_HOST',
      'POSTGRES_PORT',
      'POSTGRES_DB',
      'POSTGRES_USER',
      'DB_PASSWORD',
      'REDIS_HOST',
      'REDIS_PORT',
      'REDIS_PASSWORD',
    ]) {
      expect(mensagem).toContain(nome);
    }
  });

  it('a senha não aparece ao serializar ou inspecionar o env carregado', async () => {
    const senhaDoBanco = segredo();
    const senhaDoRedis = segredo();
    const { inspect } = await import('node:util');

    const env = carregarEnv(envValido({ DB_PASSWORD: senhaDoBanco, REDIS_PASSWORD: senhaDoRedis }));

    expect(env.postgres.password).toBe(senhaDoBanco);
    expect(env.redis.password).toBe(senhaDoRedis);
    for (const texto of [
      JSON.stringify(env),
      inspect(env, { depth: 5 }),
      String(Object.keys(env)),
    ]) {
      expect(texto).not.toContain(senhaDoBanco);
      expect(texto).not.toContain(senhaDoRedis);
    }
  });
});

// specs/014 §Leitura e ADR 0023: exatamente uma de <VAR> e <VAR>_FILE; forma canônica.
describe.each(['DB_PASSWORD', 'REDIS_PASSWORD'])(
  'carregarEnv: segredo %s (specs/014 §Leitura)',
  (nome) => {
    const arquivoDaVar = `${nome}_FILE`;
    let pasta: string;

    beforeEach(() => {
      pasta = mkdtempSync(join(tmpdir(), 'leilao-segredos-'));
    });

    afterEach(() => {
      chmodSync(pasta, 0o700);
      rmSync(pasta, { recursive: true, force: true });
    });

    function gravar(conteudo: string | Buffer, modo = 0o600): string {
      const caminho = join(pasta, 'segredo');
      writeFileSync(caminho, conteudo, { mode: modo });
      chmodSync(caminho, modo);
      return caminho;
    }

    function semAVariavel(
      extra: Record<string, string | undefined>,
    ): Record<string, string | undefined> {
      return envValido({ [nome]: undefined, ...extra });
    }

    function senhaLida(env: ReturnType<typeof carregarEnv>): string {
      return nome === 'DB_PASSWORD' ? env.postgres.password : env.redis.password;
    }

    it(`lê o valor de ${nome}`, () => {
      const valor = segredo();

      expect(senhaLida(carregarEnv(envValido({ [nome]: valor })))).toBe(valor);
    });

    it(`lê o valor do arquivo de ${arquivoDaVar}`, () => {
      const valor = segredo();

      const env = carregarEnv(semAVariavel({ [arquivoDaVar]: gravar(valor) }));

      expect(senhaLida(env)).toBe(valor);
    });

    it(`não sobe com ${nome} e ${arquivoDaVar} juntos`, () => {
      const valor = segredo();

      const mensagem = mensagemDe(() =>
        carregarEnv(envValido({ [nome]: valor, [arquivoDaVar]: gravar(valor) })),
      );

      expect(mensagem).toContain(nome);
      expect(mensagem).toContain(arquivoDaVar);
      expect(mensagem).not.toContain(valor);
    });

    it(`não sobe com ${nome} vazio junto de ${arquivoDaVar} (as duas estão definidas)`, () => {
      expect(
        mensagemDe(() => carregarEnv(envValido({ [nome]: '', [arquivoDaVar]: gravar(segredo()) }))),
      ).toContain(arquivoDaVar);
    });

    it(`não sobe com ${arquivoDaVar} apontando para arquivo inexistente`, () => {
      const caminho = join(pasta, 'nao-existe');

      const mensagem = mensagemDe(() => carregarEnv(semAVariavel({ [arquivoDaVar]: caminho })));

      expect(mensagem).toContain(arquivoDaVar);
      expect(mensagem).not.toContain(caminho);
    });

    it.skipIf(process.getuid?.() === 0)(
      `não sobe com o arquivo de ${arquivoDaVar} ilegível`,
      () => {
        const valor = segredo();
        const caminho = gravar(valor, 0o000);

        const mensagem = mensagemDe(() => carregarEnv(semAVariavel({ [arquivoDaVar]: caminho })));

        expect(mensagem).toContain(arquivoDaVar);
        expect(mensagem).not.toContain(valor);
      },
    );

    it(`não sobe com ${arquivoDaVar} apontando para um diretório`, () => {
      expect(mensagemDe(() => carregarEnv(semAVariavel({ [arquivoDaVar]: pasta })))).toContain(
        arquivoDaVar,
      );
    });

    it(`não sobe com ${arquivoDaVar} apontando para um dispositivo (não lê /dev/zero)`, () => {
      expect(
        mensagemDe(() => carregarEnv(semAVariavel({ [arquivoDaVar]: '/dev/zero' }))),
      ).toContain(arquivoDaVar);
    });

    it(`não sobe com ${arquivoDaVar} relativo (specs/014: caminho absoluto)`, () => {
      expect(
        mensagemDe(() => carregarEnv(semAVariavel({ [arquivoDaVar]: 'segredos/db_password' }))),
      ).toContain(arquivoDaVar);
    });

    it(`recusa quebra de linha no fim do arquivo de ${arquivoDaVar}`, () => {
      const valor = segredo();

      const mensagem = mensagemDe(() =>
        carregarEnv(semAVariavel({ [arquivoDaVar]: gravar(`${valor}\n`) })),
      );

      expect(mensagem).toContain(arquivoDaVar);
      expect(mensagem).not.toContain(valor);
    });

    it(`recusa arquivo de ${arquivoDaVar} vazio`, () => {
      expect(mensagemDe(() => carregarEnv(semAVariavel({ [arquivoDaVar]: gravar('') })))).toContain(
        arquivoDaVar,
      );
    });

    // Exemplos fora da forma canônica: tamanho, alfabeto, padding, quebra de linha e um último
    // caractere com bits extras (decodifica para os mesmos 32 bytes, mas recodificar muda o texto).
    const canonico = randomBytes(32).toString('base64url');
    const naoCanonicos: readonly [string, string][] = [
      ['42 caracteres', canonico.slice(0, 42)],
      ['44 caracteres', `${canonico}A`],
      ['com padding', `${canonico.slice(0, 42)}=`],
      ['alfabeto base64 padrão (+ e /)', `${canonico.slice(0, 41)}+/`],
      ['com espaço no fim', `${canonico} `],
      ['com quebra de linha no fim', `${canonico}\n`],
      ['vazio', ''],
    ];

    it.each(naoCanonicos)(`recusa ${nome} %s`, (_, valor) => {
      const mensagem = mensagemDe(() => carregarEnv(envValido({ [nome]: valor })));

      expect(mensagem).toContain(nome);
      if (valor !== '') {
        expect(mensagem).not.toContain(valor.trim());
      }
    });

    it(`recusa ${nome} de 43 caracteres cuja recodificação difere do texto`, () => {
      // 43 caracteres levam 258 bits; os 2 últimos sobram. 'B' liga um deles: decodifica para os
      // mesmos 32 bytes zero de 'AAA...A', mas recodificar devolve 'A' no fim.
      const comBitsExtras = `${'A'.repeat(42)}B`;
      expect(Buffer.from(comBitsExtras, 'base64url')).toHaveLength(32);
      expect(Buffer.from(comBitsExtras, 'base64url').toString('base64url')).not.toBe(comBitsExtras);

      const mensagem = mensagemDe(() => carregarEnv(envValido({ [nome]: comBitsExtras })));

      expect(mensagem).toContain(nome);
      expect(mensagem).not.toContain(comBitsExtras);
    });

    it(`valor fora da forma canônica no arquivo cita ${arquivoDaVar}, não o valor`, () => {
      const valor = `${canonico.slice(0, 42)}=`;

      const mensagem = mensagemDe(() =>
        carregarEnv(semAVariavel({ [arquivoDaVar]: gravar(valor) })),
      );

      expect(mensagem).toContain(arquivoDaVar);
      expect(mensagem).not.toContain(canonico.slice(0, 42));
    });
  },
);
