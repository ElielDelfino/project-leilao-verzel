// Integração (Postgres real): runner de migrations e migration 0000 (tarefa 003).
// Conecta com POSTGRES_* + DB_PASSWORD (conexao.ts), cria um banco descartável, aplica as
// migrations do zero nele e o apaga no fim.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DrizzleQueryError } from 'drizzle-orm/errors';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  type ConexaoDoBanco,
  ErroDeConfiguracaoDoBanco,
  trocarBanco,
} from '../../src/db/conexao.js';
import {
  aplicarMigrations,
  descreverFalha,
  ErroDoPapelDaApi,
  PASTA_DAS_MIGRATIONS,
  sincronizarSenhaDoPapelDaApi,
} from '../../src/db/migrate.js';
import { verificadorConfere, verificadorScram } from '../../src/db/scram.js';
import { ambienteDeTeste } from './ambiente-de-teste.js';

// Com LEILAO_TEST_DB definido, falta de variável derruba a coleta; sem ele, os testes de banco
// são pulados (ambiente-de-teste.ts).
const AMBIENTE = ambienteDeTeste(process.env);
const NOME_DO_BANCO = `leilao_t003_${randomBytes(6).toString('hex')}`;
const admin = (): ConexaoDoBanco => AMBIENTE.conexao();
const banco = (): ConexaoDoBanco => trocarBanco(AMBIENTE.conexao(), NOME_DO_BANCO);

/** Mesma chave de migrate.ts (privada lá de propósito; um teste quebra se divergir). */
const CHAVE_DO_LOCK = 3_003_000_001;

/** SQLSTATE restrict_violation, usado por impedir_alteracao(). */
const SQLSTATE_APPEND_ONLY = '23001';

interface Diario {
  readonly entries: readonly {
    readonly idx: number;
    readonly when: number;
    readonly tag: string;
  }[];
}

function diario(): Diario {
  return JSON.parse(
    readFileSync(join(PASTA_DAS_MIGRATIONS, 'meta', '_journal.json'), 'utf8'),
  ) as Diario;
}

function quantidadeDeMigrations(): number {
  return diario().entries.length;
}

async function comCliente<T>(
  conexao: ConexaoDoBanco,
  fn: (cliente: pg.Client) => Promise<T>,
): Promise<T> {
  const cliente = new pg.Client(conexao);
  await cliente.connect();
  try {
    return await fn(cliente);
  } finally {
    await cliente.end();
  }
}

async function rotulosDoEnum(cliente: pg.Client, tipo: string): Promise<string[]> {
  const { rows } = await cliente.query<{ rotulo: string }>(
    `select e.enumlabel as rotulo
       from pg_enum e join pg_type t on t.oid = e.enumtypid
       join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public' and t.typname = $1
      order by e.enumsortorder`,
    [tipo],
  );
  return rows.map((linha) => linha.rotulo);
}

/** Executa o comando e devolve o erro do Postgres (ou falha o teste se ele passar). */
async function erroDe(cliente: pg.Client, comando: string): Promise<pg.DatabaseError> {
  try {
    await cliente.query(comando);
  } catch (erro: unknown) {
    if (erro instanceof pg.DatabaseError) {
      return erro;
    }
    throw erro;
  }
  throw new Error(`o comando deveria ter falhado: ${comando}`);
}

describe('_journal.json (database/postgres/README.md, "Ordem do _journal.json")', () => {
  it('idx é 0, 1, 2... e o when cresce estritamente junto com o idx', () => {
    const entradas = diario().entries;

    expect(entradas.map((entrada) => entrada.idx)).toEqual(entradas.map((_, indice) => indice));
    for (let i = 1; i < entradas.length; i++) {
      expect(entradas[i]?.when, entradas[i]?.tag).toBeGreaterThan(entradas[i - 1]?.when ?? 0);
    }
  });
});

describe('verificador SCRAM-SHA-256', () => {
  // Vetor da RFC 7677 §3 (senha "pencil"), no formato do pg_authid.
  const SAL_DA_RFC = Buffer.from('W22ZaJ0SNY7soEsUEjb6gQ==', 'base64');
  const VERIFICADOR_DA_RFC =
    'SCRAM-SHA-256$4096:W22ZaJ0SNY7soEsUEjb6gQ==$' +
    'WG5d8oPm3OtcPnkdi4Uo7BkeZkBFzpcXkuLmtbsT4qY=:wfPLwcE6nTWhTAmQ7tl2KeoiWGPlZqQxSrmfPwDl2dU=';

  it('reproduz o vetor da RFC 7677', () => {
    expect(verificadorScram('pencil', SAL_DA_RFC)).toBe(VERIFICADOR_DA_RFC);
  });

  it('confere só a senha certa e recusa formatos estranhos', () => {
    expect(verificadorConfere(VERIFICADOR_DA_RFC, 'pencil')).toBe(true);
    expect(verificadorConfere(VERIFICADOR_DA_RFC, 'pencil2')).toBe(false);
    expect(verificadorConfere(null, 'pencil')).toBe(false);
    expect(verificadorConfere('md5abc', 'pencil')).toBe(false);
    expect(verificadorConfere('SCRAM-SHA-256$99999999:YQ==$YQ==:YQ==', 'pencil')).toBe(false);
  });

  it('o verificador não contém a senha', () => {
    const senha = randomBytes(32).toString('base64url');

    expect(verificadorScram(senha)).not.toContain(senha);
  });
});

describe('descreverFalha', () => {
  it('nunca mostra a mensagem do DrizzleQueryError, nem sem causa', () => {
    const erro = new DrizzleQueryError('insert into x values ($1)', ['segredo']);

    expect(descreverFalha(erro)).toBe('consulta do Drizzle falhou sem causa do driver');
  });

  it('usa o primeiro erro de um AggregateError (mensagem vazia)', () => {
    const raiz = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:15432'), {
      code: 'ECONNREFUSED',
    });

    expect(descreverFalha(new AggregateError([raiz], ''))).toBe(
      'Error (ECONNREFUSED): connect ECONNREFUSED 127.0.0.1:15432',
    );
  });

  it('mostra a variável que falta na configuração', () => {
    expect(descreverFalha(new ErroDeConfiguracaoDoBanco(['POSTGRES_HOST']))).toBe(
      'Conexão com o Postgres: variáveis ausentes ou inválidas: POSTGRES_HOST',
    );
  });

  it('mostra o SQLSTATE e a mensagem do Postgres, não o SQL do Drizzle', () => {
    const causa = new pg.DatabaseError('type "papel_usuario" already exists', 0, 'error');
    causa.code = '42710';
    const erro = new DrizzleQueryError('CREATE TYPE ...', [], causa);

    expect(descreverFalha(erro)).toBe('SQLSTATE 42710: type "papel_usuario" already exists');
  });

  it('mostra nome e código de uma falha de conexão', () => {
    const erro = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:15432'), {
      code: 'ECONNREFUSED',
    });

    expect(descreverFalha(erro)).toBe('Error (ECONNREFUSED): connect ECONNREFUSED 127.0.0.1:15432');
    expect(descreverFalha('x')).toBe('falha desconhecida');
  });
});

describe.skipIf(!AMBIENTE.disponivel)('com Postgres', () => {
  beforeAll(async () => {
    await comCliente(admin(), (cliente) => cliente.query(`create database ${NOME_DO_BANCO}`));
  });

  afterAll(async () => {
    await comCliente(admin(), (cliente) =>
      cliente.query(`drop database if exists ${NOME_DO_BANCO} with (force)`),
    );
  });

  describe('pnpm db:migrate (aplicarMigrations)', () => {
    it('aplica do zero, mesmo com duas execuções simultâneas', async () => {
      await Promise.all([aplicarMigrations(banco()), aplicarMigrations(banco())]);

      const aplicadas = await comCliente(banco(), async (cliente) => {
        const { rows } = await cliente.query<{ total: string }>(
          'select count(*) as total from drizzle.__drizzle_migrations',
        );
        return Number(rows[0]?.total);
      });
      expect(aplicadas).toBe(quantidadeDeMigrations());
    });

    it('é idempotente: rodar de novo não reaplica nem falha', async () => {
      await aplicarMigrations(banco());
      await aplicarMigrations(banco());

      const aplicadas = await comCliente(banco(), async (cliente) => {
        const { rows } = await cliente.query<{ total: string }>(
          'select count(*) as total from drizzle.__drizzle_migrations',
        );
        return Number(rows[0]?.total);
      });
      expect(aplicadas).toBe(quantidadeDeMigrations());
    });

    it('desiste com lock_not_available se outra execução segura o lock além da espera', async () => {
      await comCliente(banco(), async (outraExecucao) => {
        await outraExecucao.query('select pg_advisory_lock($1)', [CHAVE_DO_LOCK]);

        const erro = await aplicarMigrations(banco(), { esperaDoLockMs: 200 }).catch(
          (e: unknown) => e,
        );

        expect(erro).toBeInstanceOf(pg.DatabaseError);
        expect(descreverFalha(erro)).toMatch(/^SQLSTATE 55P03: /);
      });
    });
  });

  describe('migration 0000 (base)', () => {
    it('cria as extensões citext e pg_trgm', async () => {
      const extensoes = await comCliente(banco(), async (cliente) => {
        const { rows } = await cliente.query<{ extname: string }>(
          `select extname from pg_extension where extname in ('citext', 'pg_trgm') order by extname`,
        );
        return rows.map((linha) => linha.extname);
      });
      expect(extensoes).toEqual(['citext', 'pg_trgm']);
    });

    it('cria os enums com os valores das specs, na ordem', async () => {
      await comCliente(banco(), async (cliente) => {
        // specs/003 RF-01
        expect(await rotulosDoEnum(cliente, 'papel_usuario')).toEqual(['leiloeiro', 'licitante']);
        // specs/006 §Comportamento (estados)
        expect(await rotulosDoEnum(cliente, 'status_lote')).toEqual([
          'agendado',
          'ao_vivo',
          'encerrado',
          'cancelado',
        ]);
        // specs/004 §Comportamento (tipos de lançamento)
        expect(await rotulosDoEnum(cliente, 'tipo_lancamento')).toEqual([
          'deposito',
          'compromisso',
          'liberacao',
          'estorno',
          'debito_arremate',
          'credito_arremate',
        ]);
      });
    });
  });

  describe('migration 0001: privilégios no banco', () => {
    it('PUBLIC sem CONNECT nem TEMP; leilao_api com CONNECT e sem TEMP; o dono conecta', async () => {
      await aplicarMigrations(banco());

      const { rows } = await comCliente(banco(), (cliente) =>
        cliente.query(
          `select
             has_database_privilege('leilao_api', current_database(), 'CONNECT') as api_conecta,
             has_database_privilege('leilao_api', current_database(), 'TEMP') as api_temp,
             exists (select 1 from pg_database d, aclexplode(d.datacl) a
                      where d.datname = current_database() and a.grantee = 0) as publico,
             current_user as dono`,
        ),
      );

      expect(rows).toEqual([
        { api_conecta: true, api_temp: false, publico: false, dono: admin().user },
      ]);
    });
  });

  describe('impedir_alteracao()', () => {
    // Tabela temporária (some com a sessão) com os triggers que as tabelas append-only usarão.
    async function prepararTabela(cliente: pg.Client): Promise<void> {
      await cliente.query(
        'create temp table historico (id int primary key, valor bigint not null)',
      );
      await cliente.query(
        `create trigger historico_append_only before update or delete on historico
         for each row execute function impedir_alteracao()`,
      );
      await cliente.query(
        `create trigger historico_sem_truncate before truncate on historico
         for each statement execute function impedir_alteracao()`,
      );
      await cliente.query('insert into historico (id, valor) values (1, 100), (2, 200)');
    }

    async function linhas(cliente: pg.Client): Promise<{ id: number; valor: string }[]> {
      const { rows } = await cliente.query<{ id: number; valor: string }>(
        'select id, valor from historico order by id',
      );
      return rows;
    }

    it('permite INSERT', async () => {
      await comCliente(banco(), async (cliente) => {
        await prepararTabela(cliente);
        await cliente.query('insert into historico (id, valor) values (3, 300)');

        expect(await linhas(cliente)).toHaveLength(3);
      });
    });

    it('recusa UPDATE com restrict_violation, sem alterar a linha', async () => {
      await comCliente(banco(), async (cliente) => {
        await prepararTabela(cliente);

        const erro = await erroDe(cliente, 'update historico set valor = 999 where id = 1');

        expect(erro.code).toBe(SQLSTATE_APPEND_ONLY);
        expect(erro.table).toBe('historico');
        expect(erro.message).toContain('UPDATE');
        expect(erro.message).not.toContain('999');
        expect(await linhas(cliente)).toEqual([
          { id: 1, valor: '100' },
          { id: 2, valor: '200' },
        ]);
      });
    });

    it('recusa DELETE com restrict_violation, sem remover a linha', async () => {
      await comCliente(banco(), async (cliente) => {
        await prepararTabela(cliente);

        const erro = await erroDe(cliente, 'delete from historico where id = 2');

        expect(erro.code).toBe(SQLSTATE_APPEND_ONLY);
        expect(erro.message).toContain('DELETE');
        expect(await linhas(cliente)).toHaveLength(2);
      });
    });

    it('recusa TRUNCATE quando ligada a um trigger de instrução', async () => {
      await comCliente(banco(), async (cliente) => {
        await prepararTabela(cliente);

        const erro = await erroDe(cliente, 'truncate historico');

        expect(erro.code).toBe(SQLSTATE_APPEND_ONLY);
        expect(erro.message).toContain('TRUNCATE');
        expect(await linhas(cliente)).toHaveLength(2);
      });
    });

    it('roda com search_path vazio e sem EXECUTE para PUBLIC', async () => {
      await comCliente(banco(), async (cliente) => {
        const { rows } = await cliente.query<{ config: string[] | null; publico: boolean }>(
          `select p.proconfig as config,
                exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                         where a.grantee = 0 and a.privilege_type = 'EXECUTE') as publico
           from pg_proc p where p.oid = 'public.impedir_alteracao()'::regprocedure`,
        );

        expect(rows).toEqual([{ config: ['search_path=""'], publico: false }]);
      });
    });

    it('dispara para um papel sem EXECUTE na função (o REVOKE não quebra o trigger)', async () => {
      const papel = `t003_papel_${randomBytes(4).toString('hex')}`;
      await comCliente(banco(), async (cliente) => {
        await cliente.query(`create role ${papel} nologin`);
        try {
          await cliente.query('create table historico_papel (id int primary key)');
          await cliente.query(
            `create trigger historico_papel_append_only before update or delete on historico_papel
             for each row execute function public.impedir_alteracao()`,
          );
          await cliente.query('insert into historico_papel values (1)');
          await cliente.query(`grant select, update on historico_papel to ${papel}`);
          await cliente.query(`set role ${papel}`);

          const erro = await erroDe(cliente, 'update historico_papel set id = 2');

          expect(erro.code).toBe(SQLSTATE_APPEND_ONLY);
        } finally {
          await cliente.query('reset role');
          await cliente.query('drop table if exists historico_papel');
          await cliente.query(`drop role if exists ${papel}`);
        }
      });
    });
  });
  describe('senha do papel da API (sincronizarSenhaDoPapelDaApi)', () => {
    // Papel descartável, com os mesmos atributos de leilao_api: papéis valem para o cluster
    // inteiro, e trocar a senha do leilao_api real derrubaria a API de dev e os verifies dos
    // outros worktrees. Ele só ganha CONNECT neste banco descartável.
    const PAPEL = `t037_api_${randomBytes(4).toString('hex')}`;
    // Gerada aqui e nunca exibida.
    const SENHA = randomBytes(32).toString('base64url');

    async function estadoDoPapel(): Promise<{ login: boolean; verificador: string | null }> {
      return comCliente(admin(), async (cliente) => {
        const { rows } = await cliente.query<{ login: boolean; verificador: string | null }>(
          'select rolcanlogin as login, rolpassword as verificador from pg_authid where rolname = $1',
          [PAPEL],
        );
        const estado = rows[0];
        if (estado === undefined) {
          throw new Error('papel descartável ausente');
        }
        return estado;
      });
    }

    async function entraComo(senha: string): Promise<string> {
      return comCliente(
        {
          host: banco().host,
          port: banco().port,
          database: banco().database,
          user: PAPEL,
          password: senha,
        },
        async (cliente) => {
          const { rows } = await cliente.query<{ papel: string }>('select current_user as papel');
          return String(rows[0]?.papel);
        },
      );
    }

    beforeAll(async () => {
      await aplicarMigrations(banco());
      await comCliente(admin(), (cliente) =>
        cliente.query(
          `create role ${PAPEL} nologin nosuperuser nocreatedb nocreaterole noreplication
             nobypassrls noinherit`,
        ),
      );
      await comCliente(admin(), (cliente) =>
        cliente.query(`grant connect on database ${NOME_DO_BANCO} to ${PAPEL}`),
      );
    });

    afterAll(async () => {
      await comCliente(admin(), async (cliente) => {
        // O banco ainda existe aqui (o afterAll externo roda depois): sem o privilégio no banco,
        // o papel pode ser apagado.
        const existe = await cliente.query('select 1 from pg_roles where rolname = $1', [PAPEL]);
        if (existe.rowCount === 1) {
          await cliente.query(`revoke all on database ${NOME_DO_BANCO} from ${PAPEL}`);
          await cliente.query(`drop role ${PAPEL}`);
        }
      });
    });

    it('nenhum teste toca no leilao_api real', () => {
      expect(PAPEL).not.toBe('leilao_api');
      expect(PAPEL).toMatch(/^t037_api_[0-9a-f]{8}$/);
    });

    it('db:migrate duas vezes: aplica a senha uma vez e depois não altera nada', async () => {
      await aplicarMigrations(banco());
      const primeira = await sincronizarSenhaDoPapelDaApi(banco(), PAPEL, SENHA);
      const depoisDaPrimeira = await estadoDoPapel();
      await aplicarMigrations(banco());
      const segunda = await sincronizarSenhaDoPapelDaApi(banco(), PAPEL, SENHA);

      expect(primeira).toBe('sincronizada');
      expect(segunda).toBe('ja-sincronizada');
      expect(await estadoDoPapel()).toEqual(depoisDaPrimeira);
      expect(depoisDaPrimeira.login).toBe(true);
      expect(depoisDaPrimeira.verificador).toMatch(/^SCRAM-SHA-256\$4096:/);
    });

    it('depois dele, um login TCP como o papel funciona, e com outra senha não', async () => {
      await sincronizarSenhaDoPapelDaApi(banco(), PAPEL, SENHA);

      expect(await entraComo(SENHA)).toBe(PAPEL);
      const recusa = await entraComo(randomBytes(32).toString('base64url')).catch(
        (e: unknown) => e,
      );
      expect(recusa instanceof pg.DatabaseError && recusa.code).toBe('28P01');
    });

    it('o SQL enviado ao Postgres não contém a senha (espião no cliente)', async () => {
      const enviados: string[] = [];
      const criarComEspiao = (conexao: ConexaoDoBanco): pg.Client => {
        const cliente = new pg.Client(conexao);
        const original = cliente.query.bind(cliente) as (...args: unknown[]) => unknown;
        vi.spyOn(cliente, 'query').mockImplementation(((...args: unknown[]) => {
          enviados.push(JSON.stringify(args));
          return original(...args);
        }) as typeof cliente.query);
        return cliente;
      };
      // Força o ALTER ROLE: tira o LOGIN antes.
      await comCliente(admin(), (cliente) => cliente.query(`alter role ${PAPEL} nologin`));

      const resultado = await sincronizarSenhaDoPapelDaApi(banco(), PAPEL, SENHA, criarComEspiao);

      expect(resultado).toBe('sincronizada');
      expect(enviados.some((texto) => texto.includes('alter role'))).toBe(true);
      for (const texto of enviados) {
        expect(texto).not.toContain(SENHA);
      }
    });

    it('o ALTER ROLE roda numa transação com o log de comandos desligado', async () => {
      const enviados: string[] = [];
      const criarComEspiao = (conexao: ConexaoDoBanco): pg.Client => {
        const cliente = new pg.Client(conexao);
        const original = cliente.query.bind(cliente) as (...args: unknown[]) => unknown;
        vi.spyOn(cliente, 'query').mockImplementation(((...args: unknown[]) => {
          enviados.push(
            // Só as 5 primeiras palavras: o verificador SCRAM fica de fora da comparação.
            typeof args[0] === 'string' ? args[0].trim().split(/\s+/).slice(0, 5).join(' ') : '',
          );
          return original(...args);
        }) as typeof cliente.query);
        return cliente;
      };
      await comCliente(admin(), (cliente) => cliente.query(`alter role ${PAPEL} nologin`));

      await sincronizarSenhaDoPapelDaApi(banco(), PAPEL, SENHA, criarComEspiao);

      const inicio = enviados.indexOf('begin');
      expect(inicio).toBeGreaterThanOrEqual(0);
      expect(enviados.slice(inicio)).toEqual([
        'begin',
        "set local log_statement = 'none'",
        "set local log_min_error_statement = 'panic'",
        `alter role ${pg.escapeIdentifier(PAPEL)} login password`,
        'commit',
      ]);
      expect(await estadoDoPapel()).toMatchObject({ login: true });
    });

    it('papel inexistente ou com atributo de administração: erro que cita só a variável', async () => {
      const inexistente = `t037_${randomBytes(4).toString('hex')}`;
      const administrador = `t037_adm_${randomBytes(4).toString('hex')}`;
      await comCliente(admin(), (cliente) =>
        cliente.query(`create role ${administrador} nologin createdb`),
      );
      try {
        for (const papel of [inexistente, administrador]) {
          const erro = await sincronizarSenhaDoPapelDaApi(banco(), papel, SENHA).catch(
            (e: unknown) => e,
          );

          expect(erro).toBeInstanceOf(ErroDoPapelDaApi);
          expect(descreverFalha(erro)).toContain('POSTGRES_API_USER');
          expect(descreverFalha(erro)).not.toContain(papel);
          expect(descreverFalha(erro)).not.toContain(SENHA);
        }
        const { rows } = await comCliente(admin(), (cliente) =>
          cliente.query('select rolcanlogin, rolpassword from pg_authid where rolname = $1', [
            administrador,
          ]),
        );
        expect(rows).toEqual([{ rolcanlogin: false, rolpassword: null }]);
      } finally {
        await comCliente(admin(), (cliente) =>
          cliente.query(`drop role if exists ${administrador}`),
        );
      }
    });
  });
});
