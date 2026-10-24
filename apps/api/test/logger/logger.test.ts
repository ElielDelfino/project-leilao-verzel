import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { criarLogger, LoggerNestPino, serializarErro } from '../../src/logger/logger.js';
import { criarAppDeTeste } from '../helpers/app-de-teste.js';
import { capturarLogs, UUID } from '../helpers/captura-de-logs.js';
import { MENSAGEM_INTERNA, ModuloDeErros } from '../helpers/modulo-de-erros.js';

describe('logger Pino JSON com requestId (ADR 0018)', () => {
  let app: NestFastifyApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('cada requisição é logada em JSON com um requestId UUID', async () => {
    const { destino, linhas } = capturarLogs();
    app = await criarAppDeTeste({ destinoDosLogs: destino });

    await app.inject({ method: 'GET', url: '/api/health/live' });

    const daRequisicao = linhas.filter((linha) => 'requestId' in linha);
    expect(daRequisicao.length).toBeGreaterThan(0);
    for (const linha of daRequisicao) {
      expect(linha.requestId).toMatch(UUID);
    }
  });

  it('requisições diferentes recebem requestIds diferentes', async () => {
    const { destino, linhas } = capturarLogs();
    app = await criarAppDeTeste({ destinoDosLogs: destino });

    await app.inject({ method: 'GET', url: '/api/health/live' });
    await app.inject({ method: 'GET', url: '/api/health/live' });

    const ids = new Set(linhas.map((linha) => linha.requestId).filter(Boolean));
    expect(ids.size).toBe(2);
  });

  it('ignora um request-id enviado pelo cliente', async () => {
    const { destino, linhas } = capturarLogs();
    app = await criarAppDeTeste({ destinoDosLogs: destino });

    await app.inject({
      method: 'GET',
      url: '/api/health/live',
      headers: { 'request-id': 'forjado', 'x-request-id': 'forjado' },
    });

    expect(linhas.some((linha) => linha.requestId === 'forjado')).toBe(false);
  });

  it('a requisição é logada só com método e caminho, sem query string nem cabeçalhos', async () => {
    const { destino, linhas } = capturarLogs();
    app = await criarAppDeTeste({ destinoDosLogs: destino });

    await app.inject({
      method: 'GET',
      url: '/api/health/live?token=SEGREDO123&email=fulano@exemplo.com',
      headers: { authorization: 'Bearer SEGREDO123', cookie: 'access_token=SEGREDO123' },
    });

    const comReq = linhas.filter((linha) => 'req' in linha);
    expect(comReq.length).toBeGreaterThan(0);
    for (const linha of comReq) {
      expect(linha.req).toEqual({ method: 'GET', url: '/api/health/live' });
    }
    const tudo = JSON.stringify(linhas);
    expect(tudo).not.toContain('SEGREDO123');
    expect(tudo).not.toContain('fulano@exemplo.com');
  });

  it('erro não tratado é logado no servidor com o requestId e a causa', async () => {
    const { destino, linhas } = capturarLogs();
    app = await criarAppDeTeste({ destinoDosLogs: destino, modulosExtras: [ModuloDeErros] });

    await app.inject({ method: 'GET', url: '/api/teste-erros/nao-tratado' });

    const erro = linhas.find((linha) => linha.level === 50);
    expect(erro).toBeDefined();
    expect(erro?.requestId).toMatch(UUID);
    expect(JSON.stringify(erro)).toContain(MENSAGEM_INTERNA);
  });
});

describe('LoggerNestPino', () => {
  it('encaminha os logs do Nest ao Pino com o contexto', () => {
    const { destino, linhas } = capturarLogs();
    const logger = new LoggerNestPino(criarLogger('info', destino));

    logger.log('aplicação iniciada', 'NestApplication');
    logger.warn('cuidado');

    expect(linhas).toEqual([
      expect.objectContaining({
        level: 30,
        msg: 'aplicação iniciada',
        contexto: 'NestApplication',
      }),
      expect.objectContaining({ level: 40, msg: 'cuidado' }),
    ]);
    expect(linhas[1]).not.toHaveProperty('contexto');
  });

  it('respeita o nível configurado', () => {
    const { destino, linhas } = capturarLogs();
    const logger = new LoggerNestPino(criarLogger('warn', destino));

    logger.log('informativo');
    logger.debug('depuração');
    logger.error('falhou', 'pilha simulada', 'Contexto');

    expect(linhas).toEqual([
      expect.objectContaining({
        level: 50,
        msg: 'falhou',
        contexto: 'Contexto',
        stack: 'pilha simulada',
      }),
    ]);
  });

  it('não lança ao logar BigInt nem objeto com referência circular', () => {
    const { destino, linhas } = capturarLogs();
    const logger = new LoggerNestPino(criarLogger('info', destino));
    const circular: Record<string, unknown> = { nome: 'ciclo' };
    circular.eu = circular;

    expect(() => logger.log({ valor: 10n })).not.toThrow();
    expect(() => logger.log(circular)).not.toThrow();
    expect(() => logger.log(10n)).not.toThrow();

    expect(linhas).toHaveLength(3);
    expect(linhas[2]?.msg).toBe('10');
  });

  it('error(mensagem, stack) sem contexto grava o stack em stack, não em contexto', () => {
    const { destino, linhas } = capturarLogs();
    const logger = new LoggerNestPino(criarLogger('info', destino));
    const stack = new Error('quebrou').stack ?? '';

    logger.error('falhou', stack);

    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ level: 50, msg: 'falhou', stack });
    expect(linhas[0]).not.toHaveProperty('contexto');
  });

  it('error(mensagem, contexto) sem stack grava só o contexto', () => {
    const { destino, linhas } = capturarLogs();
    const logger = new LoggerNestPino(criarLogger('info', destino));

    logger.error('falhou', 'Contexto');

    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ level: 50, msg: 'falhou', contexto: 'Contexto' });
    expect(linhas[0]).not.toHaveProperty('stack');
  });

  it('Logger do Nest com contexto: error(mensagem, stack) grava stack e contexto', () => {
    const { destino, linhas } = capturarLogs();
    const logger = new LoggerNestPino(criarLogger('info', destino));
    const stack = new Error('quebrou').stack ?? '';

    // O Logger do Nest acrescenta o contexto ao fim: error(mensagem, stack, contexto).
    logger.error('falhou', stack, 'ModuloQualquer');

    expect(linhas[0]).toMatchObject({ msg: 'falhou', stack, contexto: 'ModuloQualquer' });
  });

  it('fatal(mensagem, stack) sem contexto também grava o stack em stack', () => {
    const { destino, linhas } = capturarLogs();
    const logger = new LoggerNestPino(criarLogger('info', destino));
    const stack = new Error('quebrou').stack ?? '';

    logger.fatal('caiu', stack);

    expect(linhas[0]).toMatchObject({ level: 60, msg: 'caiu', stack });
    expect(linhas[0]).not.toHaveProperty('contexto');
  });

  it('loga Error com a causa serializada', () => {
    const { destino, linhas } = capturarLogs();
    const logger = new LoggerNestPino(criarLogger('info', destino));

    logger.error(new Error('quebrou'), 'Contexto');

    expect(linhas).toEqual([
      expect.objectContaining({ level: 50, msg: 'quebrou', contexto: 'Contexto' }),
    ]);
    expect(linhas[0]?.err).toMatchObject({ message: 'quebrou' });
  });
});

describe('serializador err (sem PII de drivers)', () => {
  const PII = 'fulano@exemplo.com';

  function erroDeDriver(mensagem = 'duplicate key value violates unique constraint'): Error {
    return Object.assign(new Error(mensagem), {
      code: '23505',
      constraint: 'users_email_key',
      detail: `Key (email)=(${PII}) already exists.`,
      parameters: [PII],
      params: [PII],
    });
  }

  it('mantém tipo, mensagem, stack e código, e descarta detail, parameters e params', () => {
    const { destino, linhas } = capturarLogs();

    criarLogger('info', destino).error({ err: erroDeDriver() }, 'falha no banco');

    expect(linhas[0]?.err).toMatchObject({
      type: 'Error',
      message: 'duplicate key value violates unique constraint',
      stack: expect.stringContaining('duplicate key'),
      code: '23505',
      constraint: 'users_email_key',
    });
    expect(linhas[0]?.err).not.toHaveProperty('detail');
    expect(linhas[0]?.err).not.toHaveProperty('parameters');
    expect(linhas[0]?.err).not.toHaveProperty('params');
    expect(JSON.stringify(linhas)).not.toContain(PII);
  });

  it('descarta os campos também em erros aninhados e agregados', () => {
    const { destino, linhas } = capturarLogs();
    const embrulho = Object.assign(new Error('falha na consulta'), { original: erroDeDriver() });
    const agregado = new AggregateError([erroDeDriver()], 'várias falhas');

    const logger = criarLogger('info', destino);
    logger.error({ err: embrulho }, 'aninhado');
    logger.error({ err: agregado }, 'agregado');

    expect(linhas).toHaveLength(2);
    expect(JSON.stringify(linhas)).not.toContain(PII);
    expect(linhas[0]?.err).toMatchObject({ original: { code: '23505' } });
    expect(linhas[1]?.err).toMatchObject({ aggregateErrors: [{ code: '23505' }] });
  });

  it('não lança com referência circular em um campo do erro', () => {
    const { destino, linhas } = capturarLogs();
    const ciclo: Record<string, unknown> = { detail: PII };
    ciclo.eu = ciclo;
    const erro = Object.assign(new Error('ciclo'), { contexto: ciclo });

    expect(() => criarLogger('info', destino).error({ err: erro }, 'ciclo')).not.toThrow();
    expect(JSON.stringify(linhas)).not.toContain(PII);
    expect(linhas[0]?.err).toMatchObject({ contexto: { eu: '[Circular]' } });
  });

  it('ciclo direto num valor que não é Error vira "[Circular]"', () => {
    const ciclo: Record<string, unknown> = { code: 'X', detail: PII };
    ciclo.eu = ciclo;

    expect(serializarErro(ciclo)).toEqual({ code: 'X', eu: '[Circular]' });
  });

  it('o mesmo objeto em dois ramos é copiado nos dois, sem "[Circular]"', () => {
    const compartilhado = { tabela: 'users', detail: PII };
    const erro = Object.assign(new Error('x'), { a: compartilhado, b: compartilhado });

    expect(serializarErro(erro)).toMatchObject({
      a: { tabela: 'users' },
      b: { tabela: 'users' },
    });
    expect(JSON.stringify(serializarErro(erro))).not.toContain(PII);
  });

  it('Date, Buffer e TypedArray continuam serializados pelo próprio formato', () => {
    const { destino, linhas } = capturarLogs();
    const quando = new Date('2026-10-24T20:00:00.000Z');
    const erro = Object.assign(new Error('x'), {
      quando,
      bytes: Buffer.from('ab'),
      numeros: new Uint8Array([1, 2]),
    });

    criarLogger('info', destino).error({ err: erro }, 'x');

    expect(linhas[0]?.err).toMatchObject({
      quando: '2026-10-24T20:00:00.000Z',
      bytes: { type: 'Buffer', data: [97, 98] },
      numeros: { 0: 1, 1: 2 },
    });
  });

  it('toJSON próprio do erro não contorna o filtro de PII', () => {
    const erro = Object.assign(new Error('e'), { toJSON: () => ({ detail: PII, code: 'X' }) });

    const serializado = serializarErro(erro);

    expect(JSON.stringify(serializado)).not.toContain(PII);
    expect(JSON.parse(JSON.stringify(serializado))).toEqual({ code: 'X' });
  });

  it('toJSON de um objeto aninhado também passa pelo filtro', () => {
    const aninhado = { toJSON: () => ({ params: [PII], tabela: 'users' }) };
    const erro = Object.assign(new Error('e'), { consulta: aninhado });

    const serializado = JSON.stringify(serializarErro(erro));

    expect(serializado).not.toContain(PII);
    expect(serializado).toContain('"consulta":{"tabela":"users"}');
  });

  it('toJSON que lança não derruba o log', () => {
    const quebrado = {
      toJSON: () => {
        throw new Error('toJSON quebrado');
      },
    };

    expect(serializarErro(Object.assign(new Error('e'), { quebrado }))).toMatchObject({
      quebrado: '[toJSON falhou]',
    });
  });

  it('objeto profundo demais é truncado, sem RangeError', () => {
    const { destino, linhas } = capturarLogs();
    let profundo: Record<string, unknown> = { detail: PII };
    for (let nivel = 0; nivel < 20_000; nivel += 1) {
      profundo = { filho: profundo };
    }
    const erro = Object.assign(new Error('fundo'), { profundo });

    expect(() => criarLogger('info', destino).error({ err: erro }, 'fundo')).not.toThrow();
    expect(linhas).toHaveLength(1);
    expect(JSON.stringify(serializarErro(erro))).toContain('[Truncated]');
    expect(JSON.stringify(linhas)).not.toContain(PII);
  });

  it('valor que não é Error passa sem os campos de PII', () => {
    expect(serializarErro({ detail: PII, code: 'X' })).toEqual({ code: 'X' });
    expect(serializarErro('texto')).toBe('texto');
  });
});
