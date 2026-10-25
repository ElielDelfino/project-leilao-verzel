import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Namespace } from 'socket.io';
import { io, Manager, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { emitirAccessToken } from '../../../src/modules/identidade/tokens.js';
import { GatewayDoLeilao } from '../../../src/modules/tempo-real/gateway-do-leilao.js';
import { criarAppDeTeste, ENV_DE_TESTE } from '../../helpers/app-de-teste.js';

// Servidor Nest real na porta 0 + socket.io-client (tarefa 082, specs/009). O Redis é o falso do
// app de teste: `duplicarParaPubSub` lança, então o gateway roda com o adapter em memória, que é
// também o caso "sem Redis no boot" pedido pela tarefa. O servidor exige o cabeçalho `Origin`
// (um cliente que não é navegador precisa mandá-lo): `conectar` manda `WEB_ORIGIN` por padrão.

const ORIGEM = ENV_DE_TESTE.WEB_ORIGIN;
const ESPERA_MAXIMA_MS = 3_000;

type Ack = { sucesso: boolean; erro?: { codigo: string } };

interface OpcoesDoCliente {
  readonly cookie?: string;
  readonly origem?: string | null;
  readonly transports?: string[];
}

const apps: NestFastifyApplication[] = [];
const sockets: Socket[] = [];

async function subirApp(
  opcoes: Parameters<typeof criarAppDeTeste>[0] = {},
): Promise<{ app: NestFastifyApplication; url: string }> {
  const app = await criarAppDeTeste(opcoes);
  await app.listen({ port: 0, host: '127.0.0.1' });
  apps.push(app);
  const { port } = app.getHttpServer().address() as AddressInfo;
  return { app, url: `http://127.0.0.1:${String(port)}/leilao` };
}

function conectar(url: string, opcoes: OpcoesDoCliente = {}): Socket {
  const origem = opcoes.origem === undefined ? ORIGEM : opcoes.origem;
  const extraHeaders: Record<string, string> = {};
  if (origem !== null) extraHeaders['Origin'] = origem;
  if (opcoes.cookie !== undefined) extraHeaders['Cookie'] = opcoes.cookie;
  const socket = io(url, {
    transports: opcoes.transports ?? ['websocket'],
    extraHeaders,
    reconnection: false,
    forceNew: true,
  });
  sockets.push(socket);
  return socket;
}

function aguardar(socket: Socket, evento: 'connect' | 'connect_error'): Promise<Error | undefined> {
  return new Promise((resolver, rejeitar) => {
    const prazo = setTimeout(() => {
      rejeitar(new Error(`sem "${evento}" em ${String(ESPERA_MAXIMA_MS)} ms`));
    }, ESPERA_MAXIMA_MS);
    socket.once(evento, (erro?: Error) => {
      clearTimeout(prazo);
      resolver(erro);
    });
  });
}

async function conectado(url: string, opcoes: OpcoesDoCliente = {}): Promise<Socket> {
  const socket = conectar(url, opcoes);
  await aguardar(socket, 'connect');
  return socket;
}

async function recusado(url: string, opcoes: OpcoesDoCliente = {}): Promise<string> {
  const socket = conectar(url, opcoes);
  const erro = await aguardar(socket, 'connect_error');
  return erro?.message ?? '';
}

async function enviar(socket: Socket, evento: string, payload?: unknown): Promise<Ack> {
  return (await socket.timeout(ESPERA_MAXIMA_MS).emitWithAck(evento, payload)) as Ack;
}

async function cookieDeSessao(usuarioId: string): Promise<string> {
  const token = await emitirAccessToken(ENV_DE_TESTE.segredos.chaveJwt, {
    id: usuarioId,
    papel: 'licitante',
  });
  return `access_token=${token}`;
}

function namespaceDe(app: NestFastifyApplication): Namespace {
  const gateway = app.get(GatewayDoLeilao) as unknown as { namespace: Namespace };
  return gateway.namespace;
}

function salas(app: NestFastifyApplication): Namespace['adapter']['rooms'] {
  return namespaceDe(app).adapter.rooms;
}

/**
 * Dois namespaces numa só conexão do engine: `/` mantém o engine aberto enquanto `/leilao` se
 * desconecta e reconecta várias vezes (o cliente só fecha o engine quando o último namespace sai).
 */
async function compartilharConexao(url: string): Promise<{ leilao: Socket }> {
  const gerente = new Manager(url.replace(/\/leilao$/, ''), {
    transports: ['websocket'],
    extraHeaders: { Origin: ORIGEM },
    reconnection: false,
    autoConnect: false,
  });
  const raiz = gerente.socket('/');
  const leilao = gerente.socket('/leilao');
  sockets.push(raiz, leilao);
  raiz.connect();
  await aguardar(raiz, 'connect');
  leilao.connect();
  await aguardar(leilao, 'connect');
  return { leilao };
}

/** Espera uma condição do servidor (consulta a cada 10 ms) ou falha ao estourar o prazo. */
async function aguardarServidor(condicao: () => boolean, descricao: string): Promise<void> {
  const limite = Date.now() + ESPERA_MAXIMA_MS;
  while (!condicao()) {
    if (Date.now() > limite) throw new Error(`o servidor não chegou a: ${descricao}`);
    await new Promise((resolver) => setTimeout(resolver, 10));
  }
}

/**
 * Desconecta o namespace e o conecta de novo na mesma conexão do engine. O socket.io do servidor
 * trata o DISCONNECT em `process.nextTick`; um CONNECT do mesmo namespace que chegue junto cai
 * num "invalid state" e ele fecha a conexão inteira. Por isso o cliente espera o servidor
 * processar a saída antes de reconectar (um navegador de verdade nunca faz as duas coisas no mesmo tick).
 */
async function reconectar(app: NestFastifyApplication, leilao: Socket): Promise<void> {
  leilao.disconnect();
  await aguardarServidor(() => namespaceDe(app).sockets.size === 0, 'fechar o socket do namespace');
  leilao.connect();
  await Promise.race([
    aguardar(leilao, 'connect'),
    aguardar(leilao, 'connect_error').then((erro) => {
      throw new Error(`reconexão recusada: ${erro?.message ?? '?'}`);
    }),
  ]);
}

/** `sair_lote`, `entrar_vitrine` e `sair_vitrine` não têm ack (asyncapi): só disparam o evento. */
function emitir(socket: Socket, evento: string, payload?: unknown): void {
  socket.emit(evento, payload);
}

/**
 * Os eventos de um socket chegam em ordem. Um `entrar_lote` inválido sempre responde e não mexe em
 * nenhum room: o ack dele garante que os eventos sem ack enviados antes já foram tratados.
 */
async function sincronizar(socket: Socket): Promise<void> {
  await enviar(socket, 'entrar_lote', {});
}

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  for (const app of apps.splice(0)) await app.close();
});

describe('gateway do leilão: transporte e origem', () => {
  it('aceita a conexão por websocket', async () => {
    const { url } = await subirApp();

    const socket = await conectado(url);

    expect(socket.connected).toBe(true);
  });

  it('recusa a conexão com transports: [polling]', async () => {
    const { url } = await subirApp();

    const socket = conectar(url, { transports: ['polling'] });
    const erro = await aguardar(socket, 'connect_error');

    expect(erro).toBeInstanceOf(Error);
    expect(socket.connected).toBe(false);
  });

  it('recusa origem diferente de WEB_ORIGIN', async () => {
    const { url } = await subirApp();

    const mensagem = await recusado(url, { origem: 'http://malicioso.example' });

    expect(mensagem).toBe('ORIGEM_NAO_PERMITIDA');
  });

  it('recusa a conexão sem o cabeçalho Origin', async () => {
    const { url } = await subirApp();

    const mensagem = await recusado(url, { origem: null });

    expect(mensagem).toBe('ORIGEM_NAO_PERMITIDA');
  });
});

describe('gateway do leilão: handshake', () => {
  it('autenticado entra em usuario:{id}', async () => {
    const { app, url } = await subirApp();
    const usuarioId = randomUUID();

    const socket = await conectado(url, { cookie: await cookieDeSessao(usuarioId) });
    await sincronizar(socket);

    expect(salas(app).get(`usuario:${usuarioId}`)?.size).toBe(1);
  });

  it('anônimo não entra em nenhum room privado', async () => {
    const { app, url } = await subirApp();

    const socket = await conectado(url);
    await sincronizar(socket);

    const privados = [...salas(app).keys()].filter((sala) => sala.startsWith('usuario:'));
    expect(privados).toEqual([]);
  });

  it('token inválido vale como anônimo, sem recusar o handshake', async () => {
    const { app, url } = await subirApp();

    const socket = await conectado(url, { cookie: 'access_token=lixo.que.nao-e-jwt' });
    await sincronizar(socket);

    expect(socket.connected).toBe(true);
    expect([...salas(app).keys()].some((sala) => sala.startsWith('usuario:'))).toBe(false);
  });

  it('token assinado com outra chave vale como anônimo', async () => {
    const { app, url } = await subirApp();
    const outraChave = new Uint8Array(32).fill(9);
    const token = await emitirAccessToken(outraChave, { id: randomUUID(), papel: 'licitante' });

    const socket = await conectado(url, { cookie: `access_token=${token}` });
    await sincronizar(socket);

    expect([...salas(app).keys()].some((sala) => sala.startsWith('usuario:'))).toBe(false);
  });
});

describe('gateway do leilão: rooms de lote e vitrine', () => {
  it('entrar_lote coloca o socket em lote:{id} e sair_lote o tira', async () => {
    const { app, url } = await subirApp();
    const loteId = randomUUID();
    const socket = await conectado(url);

    const ack = await enviar(socket, 'entrar_lote', { loteId });
    expect(ack.sucesso).toBe(true);
    expect(salas(app).get(`lote:${loteId}`)?.size).toBe(1);

    emitir(socket, 'sair_lote', { loteId });
    await sincronizar(socket);
    expect(salas(app).has(`lote:${loteId}`)).toBe(false);
  });

  it('entrar_vitrine e sair_vitrine mexem no room vitrine', async () => {
    const { app, url } = await subirApp();
    const socket = await conectado(url);

    emitir(socket, 'entrar_vitrine');
    await sincronizar(socket);
    expect(salas(app).get('vitrine')?.size).toBe(1);

    emitir(socket, 'sair_vitrine');
    await sincronizar(socket);
    expect(salas(app).has('vitrine')).toBe(false);
  });

  it('sair_lote com payload inválido é ignorado e não derruba a conexão', async () => {
    const { url } = await subirApp();
    const socket = await conectado(url);

    emitir(socket, 'sair_lote', { loteId: 'abc' });
    await sincronizar(socket);

    expect(socket.connected).toBe(true);
  });

  it('anônimo também lê: entra em lote e vitrine', async () => {
    const { app, url } = await subirApp();
    const loteId = randomUUID();
    const socket = await conectado(url);

    emitir(socket, 'entrar_vitrine');
    await enviar(socket, 'entrar_lote', { loteId });

    expect(salas(app).get('vitrine')?.size).toBe(1);
    expect(salas(app).get(`lote:${loteId}`)?.size).toBe(1);
  });

  it.each([
    ['loteId que não é UUID', { loteId: 'abc' }],
    ['payload ausente', undefined],
    ['campo desconhecido', { loteId: randomUUID(), extra: 1 }],
    ['loteId numérico', { loteId: 7 }],
  ])('entrar_lote com %s → DADOS_INVALIDOS e nenhum room', async (_nome, payload) => {
    const { app, url } = await subirApp();
    const socket = await conectado(url);

    const ack = await enviar(socket, 'entrar_lote', payload);

    expect(ack).toEqual({
      sucesso: false,
      erro: { codigo: 'DADOS_INVALIDOS', mensagem: expect.any(String) as string },
    });
    expect([...salas(app).keys()].some((sala) => sala.startsWith('lote:'))).toBe(false);
  });
});

describe('gateway do leilão: limites', () => {
  it('recusa o 3º socket no mesmo lote com SALA_CHEIA e libera ao sair', async () => {
    const { url } = await subirApp({ limitesDoTempoReal: { porLote: 2, total: 10 } });
    const loteId = randomUUID();
    const [a, b, c] = await Promise.all([conectado(url), conectado(url), conectado(url)]);

    expect((await enviar(a, 'entrar_lote', { loteId })).sucesso).toBe(true);
    expect((await enviar(b, 'entrar_lote', { loteId })).sucesso).toBe(true);
    const cheio = await enviar(c, 'entrar_lote', { loteId });
    expect(cheio).toMatchObject({ sucesso: false, erro: { codigo: 'SALA_CHEIA' } });

    emitir(a, 'sair_lote', { loteId });
    await sincronizar(a);
    expect((await enviar(c, 'entrar_lote', { loteId })).sucesso).toBe(true);
  });

  it('quem já está na sala não conta de novo ao repetir entrar_lote', async () => {
    const { url } = await subirApp({ limitesDoTempoReal: { porLote: 1, total: 10 } });
    const loteId = randomUUID();
    const socket = await conectado(url);

    await enviar(socket, 'entrar_lote', { loteId });
    const repetido = await enviar(socket, 'entrar_lote', { loteId });

    expect(repetido.sucesso).toBe(true);
  });

  it('o limite por lote vale por lote: outro lote segue livre', async () => {
    const { url } = await subirApp({ limitesDoTempoReal: { porLote: 1, total: 10 } });
    const [a, b] = await Promise.all([conectado(url), conectado(url)]);

    await enviar(a, 'entrar_lote', { loteId: randomUUID() });
    const ack = await enviar(b, 'entrar_lote', { loteId: randomUUID() });

    expect(ack.sucesso).toBe(true);
  });

  it('recusa a conexão acima do total com SERVIDOR_CHEIO e reaproveita a vaga ao fechar', async () => {
    const { url } = await subirApp({ limitesDoTempoReal: { porLote: 5, total: 2 } });
    const primeiro = await conectado(url);
    await conectado(url);

    expect(await recusado(url)).toBe('SERVIDOR_CHEIO');

    primeiro.close();
    await esperarVaga(url);
  });
});

describe('gateway do leilão: vaga entre as 200 e reconexão do namespace', () => {
  it('reconectar o namespace N vezes na mesma conexão não consome vagas além da ativa', async () => {
    const { app, url } = await subirApp({ limitesDoTempoReal: { porLote: 5, total: 2 } });
    const { leilao } = await compartilharConexao(url);
    const engine = [...namespaceDe(app).sockets.values()][0]?.conn;
    const ouvintesDeCloseAntes = engine?.listenerCount('close');

    for (let ciclo = 0; ciclo < 12; ciclo += 1) await reconectar(app, leilao);

    // Só 1 vaga está em uso: cabe mais uma conexão, e a seguinte é que estoura o total de 2.
    await conectado(url);
    expect(await recusado(url)).toBe('SERVIDOR_CHEIO');
    expect(engine?.listenerCount('close')).toBe(ouvintesDeCloseAntes);
  });

  it('libera a vaga ao desconectar o namespace, sem fechar a conexão do engine', async () => {
    const { url } = await subirApp({ limitesDoTempoReal: { porLote: 5, total: 1 } });
    const { leilao } = await compartilharConexao(url);
    expect(await recusado(url)).toBe('SERVIDOR_CHEIO');

    leilao.disconnect();

    await esperarVaga(url);
  });
});

describe('gateway do leilão: tetos por socket', () => {
  it('recusa o lote distinto acima do teto de rooms de lote do socket', async () => {
    const { app, url } = await subirApp({ limitesDoTempoReal: { salasDeLotePorSocket: 2 } });
    const socket = await conectado(url);
    const [a, b, c] = [randomUUID(), randomUUID(), randomUUID()];

    expect((await enviar(socket, 'entrar_lote', { loteId: a })).sucesso).toBe(true);
    expect((await enviar(socket, 'entrar_lote', { loteId: b })).sucesso).toBe(true);
    const acima = await enviar(socket, 'entrar_lote', { loteId: c });

    expect(acima).toMatchObject({ sucesso: false, erro: { codigo: 'DADOS_INVALIDOS' } });
    expect(salas(app).has(`lote:${c}`)).toBe(false);
  });

  it('com o teto padrão, o 11º lote distinto é recusado', async () => {
    const { url } = await subirApp();
    const socket = await conectado(url);

    for (let i = 0; i < 10; i += 1) {
      expect((await enviar(socket, 'entrar_lote', { loteId: randomUUID() })).sucesso).toBe(true);
    }
    const decimoPrimeiro = await enviar(socket, 'entrar_lote', { loteId: randomUUID() });

    expect(decimoPrimeiro.sucesso).toBe(false);
  });

  it('entrar de novo em lote já presente não conta, e sair libera uma vaga no teto', async () => {
    const { url } = await subirApp({ limitesDoTempoReal: { salasDeLotePorSocket: 2 } });
    const socket = await conectado(url);
    const [a, b, c] = [randomUUID(), randomUUID(), randomUUID()];
    await enviar(socket, 'entrar_lote', { loteId: a });
    await enviar(socket, 'entrar_lote', { loteId: b });

    expect((await enviar(socket, 'entrar_lote', { loteId: a })).sucesso).toBe(true);
    expect((await enviar(socket, 'entrar_lote', { loteId: c })).sucesso).toBe(false);
    emitir(socket, 'sair_lote', { loteId: a });
    await sincronizar(socket);

    expect((await enviar(socket, 'entrar_lote', { loteId: c })).sucesso).toBe(true);
  });

  it('o teto de rooms vale por socket: outro socket segue livre', async () => {
    const { url } = await subirApp({ limitesDoTempoReal: { salasDeLotePorSocket: 1 } });
    const [a, b] = await Promise.all([conectado(url), conectado(url)]);
    await enviar(a, 'entrar_lote', { loteId: randomUUID() });

    expect((await enviar(b, 'entrar_lote', { loteId: randomUUID() })).sucesso).toBe(true);
  });

  it('rajada de entrar_lote acima do limite por janela → INDISPONIVEL no excedente', async () => {
    const { url } = await subirApp({
      limitesDoTempoReal: { eventosPorJanela: 5, salasDeLotePorSocket: 100 },
    });
    const socket = await conectado(url);

    const acks = await Promise.all(
      Array.from({ length: 8 }, () => enviar(socket, 'entrar_lote', { loteId: randomUUID() })),
    );

    expect(acks.filter((ack) => ack.sucesso)).toHaveLength(5);
    expect(acks.slice(5)).toEqual(
      Array.from({ length: 3 }, () => ({
        sucesso: false,
        erro: { codigo: 'INDISPONIVEL', mensagem: expect.any(String) as string },
      })),
    );
  });

  it('eventos sem ack acima do limite são ignorados e a conexão continua', async () => {
    const { app, url } = await subirApp({ limitesDoTempoReal: { eventosPorJanela: 3 } });
    const socket = await conectado(url);

    emitir(socket, 'entrar_vitrine');
    emitir(socket, 'sair_vitrine');
    emitir(socket, 'entrar_vitrine');
    emitir(socket, 'sair_vitrine'); // 4º evento da janela: descartado
    await sincronizar(socket); // também descartado, mas o ack garante a ordem

    expect(socket.connected).toBe(true);
    expect(salas(app).get('vitrine')?.size).toBe(1);
  });

  it('o limite por janela é de cada socket: o outro não é afetado', async () => {
    const { url } = await subirApp({ limitesDoTempoReal: { eventosPorJanela: 2 } });
    const [a, b] = await Promise.all([conectado(url), conectado(url)]);
    await enviar(a, 'entrar_lote', {});
    await enviar(a, 'entrar_lote', {});
    expect((await enviar(a, 'entrar_lote', {})).erro?.codigo).toBe('INDISPONIVEL');

    expect((await enviar(b, 'entrar_lote', {})).erro?.codigo).toBe('DADOS_INVALIDOS');
  });
});

describe('gateway do leilão: falha ao entrar no room privado', () => {
  it('derruba o socket autenticado, libera a vaga e não gera rejeição sem tratamento', async () => {
    const { app, url } = await subirApp({ limitesDoTempoReal: { porLote: 5, total: 1 } });
    const adapter = namespaceDe(app).adapter;
    const original = adapter.addAll.bind(adapter);
    // Só o room `usuario:` falha (como o adapter Redis oscilando); o room do próprio socket não.
    const espiao = vi.spyOn(adapter, 'addAll').mockImplementation((id, rooms) => {
      return [...rooms].some((sala) => String(sala).startsWith('usuario:'))
        ? Promise.reject(new Error('redis oscilando'))
        : original(id, rooms);
    });
    const socket = conectar(url, { cookie: await cookieDeSessao(randomUUID()) });

    const desconectado = new Promise<string>((resolver, rejeitar) => {
      const prazo = setTimeout(() => {
        rejeitar(new Error('o socket não foi derrubado'));
      }, ESPERA_MAXIMA_MS);
      socket.once('disconnect', (motivo: string) => {
        clearTimeout(prazo);
        resolver(motivo);
      });
    });
    await desconectado;
    espiao.mockRestore();

    expect(socket.connected).toBe(false);
    await esperarVaga(url);
  });
});

/** O servidor libera a vaga ao ver o fechamento; tenta de novo até a conexão passar. */
async function esperarVaga(url: string): Promise<void> {
  const limite = Date.now() + ESPERA_MAXIMA_MS;
  for (;;) {
    const socket = conectar(url);
    const erro = await Promise.race([
      aguardar(socket, 'connect').then(() => undefined),
      aguardar(socket, 'connect_error'),
    ]).catch((falha: unknown) => falha as Error);
    if (erro === undefined && socket.connected) return;
    if (Date.now() > limite) throw new Error('a vaga não foi liberada');
    await new Promise((resolver) => setTimeout(resolver, 50));
  }
}
