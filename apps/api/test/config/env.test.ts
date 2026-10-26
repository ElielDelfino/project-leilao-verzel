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

// specs/014 §Conexão: a API conecta como o papel da API (POSTGRES_API_USER/DB_API_PASSWORD).
const CONEXAO = {
  POSTGRES_HOST: '127.0.0.1',
  POSTGRES_PORT: '15432',
  POSTGRES_DB: 'leilao',
  POSTGRES_API_USER: 'leilao_api',
  REDIS_HOST: '127.0.0.1',
  REDIS_PORT: '16379',
  WEB_ORIGIN: 'http://localhost:15173',
  SCRYFALL_USER_AGENT: 'LeilaoVerzel/0.1',
} as const;

/** Os 5 segredos que a API lê (specs/014 §Segredos; DB_PASSWORD é só do dono). */
const SEGREDOS_DA_API = [
  'DB_API_PASSWORD',
  'REDIS_PASSWORD',
  'JWT_SECRET',
  'PSEUDONYM_HMAC_KEY',
  'ED25519_PRIVATE_KEY',
] as const;

function envValido(
  extra: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    API_PORT: '13000',
    ...CONEXAO,
    DB_API_PASSWORD: segredo(),
    REDIS_PASSWORD: segredo(),
    JWT_SECRET: segredo(),
    PSEUDONYM_HMAC_KEY: segredo(),
    ED25519_PRIVATE_KEY: segredo(),
    ...extra,
  };
}

/** O valor lido de cada segredo, onde o env o guarda. */
function segredoLido(env: ReturnType<typeof carregarEnv>, nome: string): string {
  switch (nome) {
    case 'DB_API_PASSWORD':
      return env.postgres.password;
    case 'REDIS_PASSWORD':
      return env.redis.password;
    case 'JWT_SECRET':
      return Buffer.from(env.segredos.chaveJwt).toString('base64url');
    case 'PSEUDONYM_HMAC_KEY':
      return Buffer.from(env.segredos.chavePseudonimo).toString('base64url');
    case 'ED25519_PRIVATE_KEY':
      return Buffer.from(env.segredos.sementeEd25519).toString('base64url');
    default:
      throw new Error(`segredo desconhecido: ${nome}`);
  }
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
      user: 'leilao_api',
    });
    expect(env.redis).toMatchObject({ host: '127.0.0.1', port: 16379 });
    expect(env.WEB_ORIGIN).toBe('http://localhost:15173');
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

// specs/014 §Conexão da API com Postgres e Redis: obrigatórias e sem default.
describe('carregarEnv: conexão com Postgres e Redis (specs/014 §Conexão)', () => {
  it.each([
    'POSTGRES_HOST',
    'POSTGRES_PORT',
    'POSTGRES_DB',
    'POSTGRES_API_USER',
    'REDIS_HOST',
    'REDIS_PORT',
  ])('não sobe sem %s e a mensagem cita só o nome', (nome) => {
    const mensagem = mensagemDe(() => carregarEnv(envValido({ [nome]: undefined })));

    expect(mensagem).toContain(nome);
  });

  it('a API não lê POSTGRES_USER nem DB_PASSWORD (são do dono; ADR 0026)', () => {
    const senhaDoDono = segredo();

    const mensagem = mensagemDe(() =>
      carregarEnv(
        envValido({
          POSTGRES_API_USER: undefined,
          DB_API_PASSWORD: undefined,
          POSTGRES_USER: 'leilao',
          DB_PASSWORD: senhaDoDono,
        }),
      ),
    );

    expect(mensagem).toContain('POSTGRES_API_USER');
    expect(mensagem).toContain('DB_API_PASSWORD');
    expect(mensagem).not.toContain(senhaDoDono);
  });

  it('com as variáveis do dono presentes, ainda usa só as da API', () => {
    const senhaDaApi = segredo();

    const env = carregarEnv(
      envValido({ DB_API_PASSWORD: senhaDaApi, POSTGRES_USER: 'leilao', DB_PASSWORD: segredo() }),
    );

    expect(env.postgres.user).toBe('leilao_api');
    expect(env.postgres.password).toBe(senhaDaApi);
  });

  it.each(['POSTGRES_HOST', 'POSTGRES_DB', 'POSTGRES_API_USER', 'REDIS_HOST'])(
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

  it.each(SEGREDOS_DA_API)(
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
      'POSTGRES_API_USER',
      'REDIS_HOST',
      'REDIS_PORT',
      'WEB_ORIGIN',
      ...SEGREDOS_DA_API,
    ]) {
      expect(mensagem).toContain(nome);
    }
  });

  it('nenhum segredo aparece ao serializar ou inspecionar o env carregado', async () => {
    const valores = Object.fromEntries(SEGREDOS_DA_API.map((nome) => [nome, segredo()]));
    const { inspect } = await import('node:util');

    const env = carregarEnv(envValido(valores));

    for (const nome of SEGREDOS_DA_API) {
      expect(segredoLido(env, nome)).toBe(valores[nome]);
    }
    const hexDosSegredos = SEGREDOS_DA_API.map((nome) =>
      Buffer.from(valores[nome] ?? '', 'base64url').toString('hex'),
    );
    for (const texto of [
      JSON.stringify(env),
      inspect(env, { depth: 5 }),
      String(Object.keys(env)),
    ]) {
      for (const nome of SEGREDOS_DA_API) {
        expect(texto).not.toContain(valores[nome]);
      }
      for (const hex of hexDosSegredos) {
        expect(texto.replace(/[^0-9a-f]/g, '')).not.toContain(hex);
      }
    }
  });

  it('a chave do JWT são os 32 bytes decodificados de JWT_SECRET (specs/003)', () => {
    const valor = segredo();

    const env = carregarEnv(envValido({ JWT_SECRET: valor }));

    expect(env.segredos.chaveJwt).toHaveLength(32);
    expect(Buffer.from(env.segredos.chaveJwt).equals(Buffer.from(valor, 'base64url'))).toBe(true);
  });
});

// specs/003 §Cookies e specs/014 §Conexão: WEB_ORIGIN é obrigatória e decide o Secure.
describe('carregarEnv: WEB_ORIGIN', () => {
  it('não sobe sem WEB_ORIGIN', () => {
    expect(mensagemDe(() => carregarEnv(envValido({ WEB_ORIGIN: undefined })))).toContain(
      'WEB_ORIGIN',
    );
  });

  it.each(['', 'localhost:15173', 'ftp://exemplo.com', 'javascript:alert(1)', 'https://'])(
    'recusa WEB_ORIGIN=%j',
    (valor) => {
      expect(mensagemDe(() => carregarEnv(envValido({ WEB_ORIGIN: valor })))).toContain(
        'WEB_ORIGIN',
      );
    },
  );

  it.each([
    ['http://localhost:15173', false],
    ['https://10-0-0-1.sslip.io', true],
  ])('WEB_ORIGIN=%s → cookiesSeguros=%s', (valor, seguro) => {
    expect(carregarEnv(envValido({ WEB_ORIGIN: valor })).cookiesSeguros).toBe(seguro);
  });

  // Tarefa 020: em produção a origem é checada em CORS, CSRF e Socket.IO; `*` ou loopback ali
  // aceitaria qualquer origem ou nenhuma real.
  it.each([
    'http://localhost:15173',
    'https://localhost',
    'http://LOCALHOST:80',
    'http://127.0.0.1:15173',
    'https://127.1.2.3',
    'http://[::1]:15173',
    'http://0.0.0.0:15173',
    // Revisão da 020: ponto final, subdomínio de localhost e as outras grafias de loopback em IPv6.
    'http://localhost.:15173',
    'http://LOCALHOST.',
    'http://a.localhost',
    'https://app.dev.localhost:8443',
    'http://[::]:15173',
    'http://[0:0:0:0:0:0:0:1]',
    'http://[::ffff:127.0.0.1]',
    'http://[::ffff:127.9.8.7]:15173',
    'http://[::ffff:0.0.0.0]',
    'http://[::127.0.0.1]',
    'http://[0:0:0:0:0:ffff:7f00:1]',
  ])('recusa WEB_ORIGIN=%s em produção, citando só o nome', (valor) => {
    const mensagem = mensagemDe(() =>
      carregarEnv(envValido({ NODE_ENV: 'production', WEB_ORIGIN: valor })),
    );
    expect(mensagem).toContain('WEB_ORIGIN');
    expect(mensagem).toContain('produção');
    expect(mensagem).not.toContain(valor);
  });

  it('recusa WEB_ORIGIN=* dentro e fora de produção', () => {
    for (const NODE_ENV of ['production', 'development']) {
      expect(mensagemDe(() => carregarEnv(envValido({ NODE_ENV, WEB_ORIGIN: '*' })))).toContain(
        'WEB_ORIGIN',
      );
    }
  });

  it('aceita o host público em produção e localhost fora dela', () => {
    const producao = carregarEnv(
      envValido({ NODE_ENV: 'production', WEB_ORIGIN: 'https://teste-verzel.duckdns.org' }),
    );
    expect(producao.WEB_ORIGIN).toBe('https://teste-verzel.duckdns.org');
    // Um host que só começa com "localhost" não é loopback.
    expect(
      carregarEnv(
        envValido({ NODE_ENV: 'production', WEB_ORIGIN: 'https://localhost.exemplo.com' }),
      ).WEB_ORIGIN,
    ).toBe('https://localhost.exemplo.com');
    expect(carregarEnv(envValido({ NODE_ENV: 'development' })).WEB_ORIGIN).toBe(
      'http://localhost:15173',
    );
  });

  // Sem falso positivo: hosts públicos que só se parecem com loopback.
  it.each([
    'https://localhost.exemplo.com',
    'https://127.0.0.1.sslip.io',
    'https://leilao.exemplo.com:8443',
    'http://[2001:db8::7f00:1]',
    'http://[2001:db8::1]:8443',
    'http://128.0.0.1',
  ])('aceita WEB_ORIGIN=%s em produção', (valor) => {
    expect(carregarEnv(envValido({ NODE_ENV: 'production', WEB_ORIGIN: valor })).WEB_ORIGIN).toBe(
      valor,
    );
  });

  // A regex aceita estas, mas não são URLs; em produção `new URL` lançaria TypeError cru.
  it.each(['http://[bad', 'http://a:b:c'])(
    'recusa WEB_ORIGIN=%s que não é URL, dentro e fora de produção, citando só o nome',
    (valor) => {
      for (const NODE_ENV of ['production', 'development']) {
        const mensagem = mensagemDe(() => carregarEnv(envValido({ NODE_ENV, WEB_ORIGIN: valor })));
        expect(mensagem, NODE_ENV).toContain('WEB_ORIGIN');
        expect(mensagem).not.toContain(valor);
      }
    },
  );

  it('producao reflete NODE_ENV=production', () => {
    expect(
      carregarEnv(envValido({ NODE_ENV: 'production', WEB_ORIGIN: 'https://leilao.exemplo.com' }))
        .producao,
    ).toBe(true);
    expect(carregarEnv(envValido({ NODE_ENV: 'development' })).producao).toBe(false);
    expect(carregarEnv(envValido({ NODE_ENV: undefined })).producao).toBe(false);
  });
});

// specs/005 §Cliente HTTP e docs/variaveis-de-ambiente.md.
describe('carregarEnv: Scryfall', () => {
  it('não sobe sem SCRYFALL_USER_AGENT', () => {
    expect(mensagemDe(() => carregarEnv(envValido({ SCRYFALL_USER_AGENT: undefined })))).toContain(
      'SCRYFALL_USER_AGENT',
    );
  });

  it.each(['', 'Leilao\nVerzel/0.1', 'á/1'])('recusa SCRYFALL_USER_AGENT=%j', (valor) => {
    expect(mensagemDe(() => carregarEnv(envValido({ SCRYFALL_USER_AGENT: valor })))).toContain(
      'SCRYFALL_USER_AGENT',
    );
  });

  it('sem SCRYFALL_BASE_URL, usa https://api.scryfall.com', () => {
    expect(carregarEnv(envValido()).scryfall).toEqual({
      userAgent: 'LeilaoVerzel/0.1',
      baseUrl: 'https://api.scryfall.com',
      prefixoRedis: 'scryfall:',
    });
  });

  it('sem SCRYFALL_REDIS_PREFIX, o prefixo Redis é scryfall: (tarefa 099)', () => {
    expect(carregarEnv(envValido()).scryfall.prefixoRedis).toBe('scryfall:');
    expect(
      carregarEnv(envValido({ NODE_ENV: 'production', WEB_ORIGIN: 'https://leilao.exemplo.com' }))
        .scryfall.prefixoRedis,
    ).toBe('scryfall:');
  });

  it.each(['scryfall:e2e:', 'scryfall:e2e-run-1:', 'scryfall:t123-ab:'])(
    'aceita SCRYFALL_REDIS_PREFIX=%j fora de produção',
    (valor) => {
      const env = carregarEnv(envValido({ SCRYFALL_REDIS_PREFIX: valor, NODE_ENV: 'test' }));
      expect(env.scryfall.prefixoRedis).toBe(valor);
    },
  );

  it.each([
    '',
    'outro:',
    'scryfall:',
    'scryfall:x1:',
    'scryfall:e2e',
    'scryfall:E2E:',
    'scryfall:t_1:',
  ])('recusa SCRYFALL_REDIS_PREFIX=%j (formato)', (valor) => {
    const mensagem = mensagemDe(() => carregarEnv(envValido({ SCRYFALL_REDIS_PREFIX: valor })));
    expect(mensagem).toContain('SCRYFALL_REDIS_PREFIX');
    if (valor !== '') {
      expect(mensagem).not.toContain(valor);
    }
  });

  it('recusa SCRYFALL_REDIS_PREFIX em produção, mesmo no formato válido', () => {
    const mensagem = mensagemDe(() =>
      carregarEnv(envValido({ NODE_ENV: 'production', SCRYFALL_REDIS_PREFIX: 'scryfall:e2e:' })),
    );
    expect(mensagem).toContain('SCRYFALL_REDIS_PREFIX');
    expect(mensagem).toContain('produção');
  });

  it('aceita SCRYFALL_BASE_URL http://127.0.0.1:porta (Scryfall falsa)', () => {
    const env = carregarEnv(envValido({ SCRYFALL_BASE_URL: 'http://127.0.0.1:18080' }));
    expect(env.scryfall.baseUrl).toBe('http://127.0.0.1:18080');
  });

  it.each(['', 'api.scryfall.com', 'ftp://x.com', 'https://api.scryfall.com/', 'https://x.com/v1'])(
    'recusa SCRYFALL_BASE_URL=%j',
    (valor) => {
      expect(mensagemDe(() => carregarEnv(envValido({ SCRYFALL_BASE_URL: valor })))).toContain(
        'SCRYFALL_BASE_URL',
      );
    },
  );
});

// specs/014 §Leitura e ADR 0023: exatamente uma de <VAR> e <VAR>_FILE; forma canônica.
describe.each(SEGREDOS_DA_API)('carregarEnv: segredo %s (specs/014 §Leitura)', (nome) => {
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
    return segredoLido(env, nome);
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

  it.skipIf(process.getuid?.() === 0)(`não sobe com o arquivo de ${arquivoDaVar} ilegível`, () => {
    const valor = segredo();
    const caminho = gravar(valor, 0o000);

    const mensagem = mensagemDe(() => carregarEnv(semAVariavel({ [arquivoDaVar]: caminho })));

    expect(mensagem).toContain(arquivoDaVar);
    expect(mensagem).not.toContain(valor);
  });

  it(`não sobe com ${arquivoDaVar} apontando para um diretório`, () => {
    expect(mensagemDe(() => carregarEnv(semAVariavel({ [arquivoDaVar]: pasta })))).toContain(
      arquivoDaVar,
    );
  });

  it(`não sobe com ${arquivoDaVar} apontando para um dispositivo (não lê /dev/zero)`, () => {
    expect(mensagemDe(() => carregarEnv(semAVariavel({ [arquivoDaVar]: '/dev/zero' })))).toContain(
      arquivoDaVar,
    );
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

    const mensagem = mensagemDe(() => carregarEnv(semAVariavel({ [arquivoDaVar]: gravar(valor) })));

    expect(mensagem).toContain(arquivoDaVar);
    expect(mensagem).not.toContain(canonico.slice(0, 42));
  });
});
