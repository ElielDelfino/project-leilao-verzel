// Falhas de conexão do pool viram ErroDoBanco (tarefa 134, achados das revisões 111, 079 e 109).
// O BEGIN de `db.transaction` chama `pool.connect()` fora do Drizzle: a falha chegava como Error
// cru ("connect ECONNREFUSED 127.0.0.1:5432", "timeout exceeded when trying to connect",
// "Connection terminated unexpectedly") e ia para o log do 500 com o endereço do banco.
// Os três primeiros blocos não precisam do Postgres: usam uma porta fechada, um socket Unix
// inexistente ou um servidor TCP falso. O último usa o banco de teste (pulado sem
// LEILAO_TEST_DB, ambiente-de-teste.ts).
import { randomUUID } from 'node:crypto';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspect } from 'node:util';

import { sql } from 'drizzle-orm';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { DatabaseError } from 'pg';
import { afterEach, describe, expect, it } from 'vitest';

import { type ConexaoDoBanco, lerConexaoDoBanco } from '../../src/db/conexao.js';
import { type BancoVerificavel, criarBanco } from '../../src/db/banco.js';
import {
  converterErroDoBanco,
  ErroDoBanco,
  SQLSTATE_CONEXAO_PERDIDA,
  SQLSTATE_SEM_CONEXAO,
} from '../../src/db/erros.js';
import { serializarErro } from '../../src/logger/logger.js';
import { portaFechada } from '../helpers/porta-fechada.js';
import { ambienteDeTeste } from './ambiente-de-teste.js';

const AMBIENTE = ambienteDeTeste(process.env);
const HOST = '127.0.0.1';
/** Forma canônica (43 caracteres base64url de 32 bytes); não é senha de nenhum serviço. */
const SENHA = Buffer.alloc(32, 0x5a).toString('base64url');
/** Usuário e banco de teste: não podem aparecer no erro convertido (nem em caminhos do stack). */
const USUARIO = 'usuario_do_teste_do_pool';
const BANCO = 'banco_do_teste_do_pool';
/** Curto para o teste não esperar os 5 s do LIMITES_DO_POOL. */
const ESPERA_CURTA_MS = 200;

function conexaoPara(porta: number, host: string): ConexaoDoBanco {
  return lerConexaoDoBanco({
    POSTGRES_HOST: host,
    POSTGRES_PORT: String(porta),
    POSTGRES_DB: BANCO,
    POSTGRES_USER: USUARIO,
    DB_PASSWORD: SENHA,
  });
}

async function falhaDe(promessa: Promise<unknown>): Promise<unknown> {
  try {
    await promessa;
  } catch (erro: unknown) {
    return erro;
  }
  throw new Error('a operação deveria ter falhado');
}

/** Servidor TCP falso: `aoConectar` decide o que fazer com cada socket. */
async function servidorFalso(aoConectar: (socket: Socket) => void): Promise<{
  porta: number;
  fechar: () => Promise<void>;
}> {
  const sockets = new Set<Socket>();
  const servidor: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    aoConectar(socket);
  });
  await new Promise<void>((resolver) => {
    servidor.listen(0, HOST, resolver);
  });
  const endereco = servidor.address();
  if (endereco === null || typeof endereco === 'string') {
    throw new Error('servidor falso sem porta');
  }
  return {
    porta: endereco.port,
    fechar: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolver) => {
        servidor.close(() => {
          resolver();
        });
      });
    },
  };
}

/** Mensagem do protocolo do Postgres: tipo, tamanho (int32, inclui a si mesmo) e corpo. */
function mensagemDoPostgres(tipo: string, corpo: Buffer): Buffer {
  const cabecalho = Buffer.alloc(5);
  cabecalho.write(tipo, 0, 'latin1');
  cabecalho.writeInt32BE(corpo.length + 4, 1);
  return Buffer.concat([cabecalho, corpo]);
}

const LOGIN_ACEITO = Buffer.concat([
  mensagemDoPostgres('R', Buffer.from([0, 0, 0, 0])),
  mensagemDoPostgres('Z', Buffer.from('I', 'latin1')),
]);
const BEGIN_CONCLUIDO = Buffer.concat([
  mensagemDoPostgres('C', Buffer.from('BEGIN\0', 'latin1')),
  mensagemDoPostgres('Z', Buffer.from('T', 'latin1')),
]);

/**
 * Postgres falso: lê a mensagem de startup (sem tipo) e aceita o login sem senha; responde o
 * primeiro BEGIN (consulta simples 'Q'); qualquer outra mensagem derruba o socket.
 */
function postgresQueCaiDepoisDoBegin(socket: Socket): void {
  let pendente = Buffer.alloc(0);
  let iniciado = false;
  let beginRespondido = false;
  socket.on('data', (dados: Buffer) => {
    pendente = Buffer.concat([pendente, dados]);
    if (!iniciado) {
      if (pendente.length < 4) return;
      const tamanho = pendente.readInt32BE(0);
      if (pendente.length < tamanho) return;
      pendente = pendente.subarray(tamanho);
      iniciado = true;
      socket.write(LOGIN_ACEITO);
    }
    while (pendente.length >= 5) {
      const tipo = String.fromCharCode(pendente[0] ?? 0);
      const tamanho = pendente.readInt32BE(1);
      if (pendente.length < tamanho + 1) return;
      const texto = pendente.subarray(5, tamanho + 1).toString('utf8');
      pendente = pendente.subarray(tamanho + 1);
      if (!beginRespondido && tipo === 'Q' && /^begin/i.test(texto)) {
        beginRespondido = true;
        socket.write(BEGIN_CONCLUIDO);
        continue;
      }
      socket.destroy();
      return;
    }
  });
}

/**
 * Mensagem, stack, JSON, util.inspect e a linha de log do erro não levam host, porta, usuário,
 * banco, senha nem os textos `extras` (caminho do socket, SQL, parâmetros).
 */
function semEndereco(erro: unknown, porta: number, ...extras: string[]): void {
  expect(erro).toBeInstanceOf(ErroDoBanco);
  const convertido = erro as ErroDoBanco;
  const textos = [
    convertido.message,
    convertido.stack ?? '',
    JSON.stringify(convertido),
    inspect(convertido, { depth: 10, showHidden: true }),
    JSON.stringify(serializarErro(convertido)),
  ];
  for (const texto of textos) {
    for (const proibido of [HOST, String(porta), USUARIO, BANCO, SENHA, ...extras]) {
      expect(texto).not.toContain(proibido);
    }
  }
  expect(convertido.cause).toBeUndefined();
}

const limpezas: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const limpar of limpezas.splice(0).reverse()) await limpar();
});

function novoBanco(porta: number, opcoes: { max?: number; host?: string } = {}): BancoVerificavel {
  const banco = criarBanco({
    conexao: conexaoPara(porta, opcoes.host ?? HOST),
    aoErroOcioso: () => undefined,
    limitesDoPool: {
      connectionTimeoutMillis: ESPERA_CURTA_MS,
      ...(opcoes.max === undefined ? {} : { max: opcoes.max }),
    },
  });
  limpezas.push(() => banco.encerrar());
  return banco;
}

describe('pool sem Postgres: falha de conexão vira ErroDoBanco', () => {
  it('porta fechada → ErroDoBanco ECONNREFUSED na transação e na consulta, sem endereço', async () => {
    const porta = await portaFechada();
    const banco = novoBanco(porta);

    const daTransacao = await falhaDe(banco.transaction(() => Promise.resolve('nunca')));
    const daConsulta = await falhaDe(banco.consultar((db) => db.execute(sql`select 1`)));

    for (const erro of [daTransacao, daConsulta]) {
      expect((erro as ErroDoBanco).codigo).toBe('ECONNREFUSED');
      semEndereco(erro, porta);
    }
  });

  it('socket Unix inexistente → ErroDoBanco ENOENT na transação e na consulta, sem o caminho', async () => {
    // Com host diretório, o pg conecta em <host>/.s.PGSQL.<porta>; o Node lança ENOENT com
    // syscall connect e o caminho na mensagem e em `address`.
    const diretorio = join(tmpdir(), `sem-postgres-${randomUUID()}`);
    const porta = 5999;
    const banco = novoBanco(porta, { host: diretorio });

    const daTransacao = await falhaDe(banco.transaction(() => Promise.resolve('nunca')));
    const daConsulta = await falhaDe(banco.consultar((db) => db.execute(sql`select 1`)));

    for (const erro of [daTransacao, daConsulta]) {
      expect((erro as ErroDoBanco).codigo).toBe('ENOENT');
      semEndereco(erro, porta, diretorio, '.s.PGSQL');
    }
  });

  it('pool saturado (max 1, conexão ocupada) → ErroDoBanco de conexão sem endereço', async () => {
    // O servidor aceita o TCP e nunca responde: a única conexão do pool fica presa no handshake
    // e a segunda transação espera na fila até o connectionTimeoutMillis.
    const servidor = await servidorFalso(() => undefined);
    limpezas.push(servidor.fechar);
    const banco = novoBanco(servidor.porta, { max: 1 });

    const [primeira, segunda] = await Promise.all([
      falhaDe(banco.transaction(() => Promise.resolve('nunca'))),
      falhaDe(banco.transaction(() => Promise.resolve('nunca'))),
    ]);

    for (const erro of [primeira, segunda]) {
      expect((erro as ErroDoBanco).codigo).toBe(SQLSTATE_SEM_CONEXAO);
      semEndereco(erro, servidor.porta);
    }
  });

  it('servidor fecha a conexão → "Connection terminated unexpectedly" vira ErroDoBanco', async () => {
    const servidor = await servidorFalso((socket) => {
      socket.destroy();
    });
    limpezas.push(servidor.fechar);
    const banco = novoBanco(servidor.porta);

    const erro = await falhaDe(banco.transaction(() => Promise.resolve('nunca')));

    expect((erro as ErroDoBanco).codigo).toBe(SQLSTATE_CONEXAO_PERDIDA);
    semEndereco(erro, servidor.porta);
  });

  it('conexão cai no meio da transação → ErroDoBanco 08006, não "código desconhecido"', async () => {
    // A consulta depois do BEGIN falha com "Connection terminated unexpectedly", e o ROLLBACK do
    // Drizzle com "Client has encountered a connection error and is not queryable", que é o
    // erro que sai da transação e mascarava o original.
    const servidor = await servidorFalso(postgresQueCaiDepoisDoBegin);
    limpezas.push(servidor.fechar);
    const banco = novoBanco(servidor.porta);

    const erro = await falhaDe(
      banco.transaction(async (tx) => {
        await tx.execute(sql`select 1`);
      }),
    );

    expect((erro as ErroDoBanco).codigo).toBe(SQLSTATE_CONEXAO_PERDIDA);
    semEndereco(erro, servidor.porta);
  });
});

/** Error como o do `net` do Node: mensagem com endereço, `code`, `syscall`, `address`, `port`. */
function erroDeRede(code: string, porta: number, syscall = 'connect'): Error {
  return Object.assign(new Error(`${syscall} ${code} ${HOST}:${String(porta)}`), {
    errno: -111,
    code,
    syscall,
    address: HOST,
    port: porta,
  });
}

describe('converterErroDoBanco: falhas de conexão cruas', () => {
  it('AggregateError (autoSelectFamily) com todos os filhos de rede → ErroDoBanco', () => {
    // O Node cria o AggregateError com `code` do primeiro filho e sem `syscall`.
    const agregado = Object.assign(
      new AggregateError([erroDeRede('ECONNREFUSED', 5432), erroDeRede('ECONNREFUSED', 5432)], ''),
      { code: 'ECONNREFUSED' },
    );

    const convertido = converterErroDoBanco(agregado);

    expect((convertido as ErroDoBanco).codigo).toBe('ECONNREFUSED');
    semEndereco(convertido, 5432);
  });

  it('AggregateError sem `code` próprio usa o código do primeiro filho de conexão', () => {
    const agregado = new AggregateError([erroDeRede('ETIMEDOUT', 5432)], '');

    const convertido = converterErroDoBanco(agregado);

    expect((convertido as ErroDoBanco).codigo).toBe('ETIMEDOUT');
    semEndereco(convertido, 5432);
  });

  it('AggregateError misto (um filho de conexão, outro não) vira ErroDoBanco sem os filhos', () => {
    const outro = new TypeError(`falhou em ${HOST}:5432 como ${USUARIO}`);
    const agregado = new AggregateError([outro, erroDeRede('ECONNREFUSED', 5432)], `${HOST}:5432`);

    const convertido = converterErroDoBanco(agregado);

    expect((convertido as ErroDoBanco).codigo).toBe('ECONNREFUSED');
    expect(convertido).not.toHaveProperty('errors');
    semEndereco(convertido, 5432);
  });

  it('AggregateError sem nenhuma falha de conexão não muda', () => {
    const agregado = new AggregateError([new TypeError('x'), 'texto'], '');
    const vazio = new AggregateError([], '');

    expect(converterErroDoBanco(agregado)).toBe(agregado);
    expect(converterErroDoBanco(vazio)).toBe(vazio);
  });

  it('cause que não é Error, com a forma de erro de socket, vira ErroDoBanco', () => {
    const causa = {
      code: 'ECONNREFUSED',
      syscall: 'connect',
      address: HOST,
      port: 5432,
      message: `connect ECONNREFUSED ${HOST}:5432`,
    };
    const original = new Error('não deu', { cause: causa });

    const convertido = converterErroDoBanco(original) as Error;

    expect(convertido).not.toBe(original);
    expect((convertido.cause as ErroDoBanco).codigo).toBe('ECONNREFUSED');
    semEndereco(convertido.cause, 5432);
    // Texto ou objeto sem a forma de erro de socket numa cause não são do banco: não mudam.
    const comTexto = new Error('x', { cause: 'qualquer texto' });
    const comObjeto = new Error('x', { cause: { code: 'ENOENT', syscall: 'open' } });
    expect(converterErroDoBanco(comTexto)).toBe(comTexto);
    expect(converterErroDoBanco(comObjeto)).toBe(comObjeto);
  });

  it('erro de socket com qualquer código (ENOENT, EACCES, EMFILE, ENETRESET...) vira ErroDoBanco', () => {
    const casos: [string, string][] = [
      ['ENOENT', 'connect'],
      ['EACCES', 'connect'],
      ['EMFILE', 'connect'],
      ['ENETRESET', 'read'],
      ['ESOCKETTIMEDOUT', 'write'],
      ['ENOTFOUND', 'getaddrinfo'],
    ];
    for (const [codigo, chamada] of casos) {
      const convertido = converterErroDoBanco(erroDeRede(codigo, 5432, chamada));

      expect((convertido as ErroDoBanco).codigo).toBe(codigo);
      semEndereco(convertido, 5432);
    }
  });

  it('as mensagens de conexão do pg e do pg-pool viram ErroDoBanco com SQLSTATE da classe 08', () => {
    const casos: [string, string][] = [
      ['timeout exceeded when trying to connect', SQLSTATE_SEM_CONEXAO],
      ['Connection terminated due to connection timeout', SQLSTATE_SEM_CONEXAO],
      ['timeout expired', SQLSTATE_SEM_CONEXAO],
      ['Connection terminated unexpectedly', SQLSTATE_CONEXAO_PERDIDA],
      ['Client has encountered a connection error and is not queryable', SQLSTATE_CONEXAO_PERDIDA],
      ['Client was closed and is not queryable', SQLSTATE_CONEXAO_PERDIDA],
    ];
    for (const [mensagem, codigo] of casos) {
      const convertido = converterErroDoBanco(
        new Error(mensagem, { cause: erroDeRede('ECONNREFUSED', 5432) }),
      );
      expect((convertido as ErroDoBanco).codigo).toBe(codigo);
      semEndereco(convertido, 5432);
    }
  });

  it('DrizzleQueryError com a conexão perdida como causa ganha o SQLSTATE 08006, sem SQL', () => {
    for (const causa of [
      new Error('Connection terminated unexpectedly'),
      new Error('Client has encountered a connection error and is not queryable'),
    ]) {
      const original = new DrizzleQueryError(
        'select segredo_da_consulta from t where x = $1',
        ['parametro-secreto'],
        causa,
      );

      const convertido = converterErroDoBanco(original);

      expect((convertido as ErroDoBanco).codigo).toBe(SQLSTATE_CONEXAO_PERDIDA);
      semEndereco(convertido, 5432, 'segredo_da_consulta', 'parametro-secreto', 'Failed query');
    }
  });

  it('57014 e 40001 chegam como ErroDoBanco classificável', () => {
    for (const codigo of ['57014', '40001']) {
      const erro = new DatabaseError('falha', 0, 'error');
      erro.code = codigo;

      const convertido = converterErroDoBanco(new DrizzleQueryError('commit', [], erro));

      expect(convertido).toBeInstanceOf(ErroDoBanco);
      expect((convertido as ErroDoBanco).codigo).toBe(codigo);
    }
  });

  it('erro de domínio que embrulha a falha de conexão volta com a causa convertida', () => {
    const original = new Error('não deu', { cause: erroDeRede('ECONNRESET', 5432) });

    const convertido = converterErroDoBanco(original) as Error;

    expect(convertido).not.toBe(original);
    expect((convertido.cause as ErroDoBanco).codigo).toBe('ECONNRESET');
    semEndereco(convertido.cause, 5432);
  });

  it('ErroDoBanco, TypeError e erros parecidos que não são de conexão não mudam', () => {
    const jaConvertido = new ErroDoBanco({
      codigo: '23505',
      restricao: undefined,
      tabela: undefined,
      coluna: undefined,
    });
    class ErroDeDominio extends Error {}
    const intactos: unknown[] = [
      jaConvertido,
      new TypeError('Cannot read properties of undefined'),
      // Mesma mensagem, mas classe própria: não é do driver.
      new ErroDeDominio('Connection terminated unexpectedly'),
      // `code` de rede sem `syscall`: não veio do socket.
      Object.assign(new Error('x'), { code: 'ECONNREFUSED' }),
      // ENOENT de uma syscall que não é de conexão (arquivo, não socket).
      Object.assign(new Error('x'), { code: 'ENOENT', syscall: 'open' }),
      // `code` que não é string.
      Object.assign(new Error('x'), { code: 111, syscall: 'connect' }),
      new Error('timeout exceeded when trying to connect, de outro lugar'),
      'connect ECONNREFUSED 127.0.0.1:5432',
    ];

    for (const erro of intactos) {
      expect(converterErroDoBanco(erro)).toBe(erro);
    }
  });
});

describe.skipIf(!AMBIENTE.disponivel)('pool saturado com o Postgres de teste', () => {
  it('max 1 com a conexão presa numa transação → a outra recebe ErroDoBanco', async () => {
    const banco = criarBanco({
      conexao: AMBIENTE.conexao(),
      aoErroOcioso: () => undefined,
      limitesDoPool: { max: 1, connectionTimeoutMillis: ESPERA_CURTA_MS },
    });
    limpezas.push(() => banco.encerrar());
    let liberar = (): void => undefined;
    const presa = new Promise<void>((resolver) => {
      liberar = resolver;
    });
    let ocupada = (): void => undefined;
    const conexaoOcupada = new Promise<void>((resolver) => {
      ocupada = resolver;
    });
    const primeira = banco.transaction(async (tx) => {
      await tx.execute(sql`select 1`);
      ocupada();
      await presa;
    });
    await conexaoOcupada;

    const erro = await falhaDe(banco.transaction(() => Promise.resolve('nunca')));
    liberar();
    await primeira;

    expect(erro).toBeInstanceOf(ErroDoBanco);
    expect((erro as ErroDoBanco).codigo).toBe(SQLSTATE_SEM_CONEXAO);
  });
});
