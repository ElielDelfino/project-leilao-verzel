import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { io, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it, type MockInstance, vi } from 'vitest';

import { PublicadorDeEventos } from '../../../src/common/eventos/publicador-de-eventos.js';
import { emitirAccessToken } from '../../../src/modules/identidade/tokens.js';
import {
  type EstadoDaSala,
  MontadorDoEstado,
} from '../../../src/modules/tempo-real/estado-da-sala.js';
import { GatewayDoLeilao } from '../../../src/modules/tempo-real/gateway-do-leilao.js';
import { criarAppDeTeste, ENV_DE_TESTE } from '../../helpers/app-de-teste.js';
import { validarAckDeEntrada, validarEvento, versaoDoAsyncapi } from './contrato-asyncapi.js';

// Ack de `entrar_lote` e difusão dos eventos por room, com servidor Nest real e socket.io-client
// (tarefa 083, specs/009). O banco é o falso do app de teste: o MontadorDoEstado é simulado aqui;
// a montagem real (Postgres) está em estado-da-sala.integracao.test.ts.

const ESPERA_MS = 3_000;
/** Janela em que um evento que não deve chegar teria chegado (mesmo processo, sem rede real). */
const SILENCIO_MS = 150;
const INSTANTE = '2026-10-25T12:00:00.000Z';

type Ack = Record<string, unknown> & { sucesso: boolean; erro?: { codigo: string } };

const apps: NestFastifyApplication[] = [];
const sockets: Socket[] = [];

function estado(loteId: string, usuarioId: string | undefined): EstadoDaSala {
  const base: EstadoDaSala = {
    lote: {
      id: loteId,
      status: 'ao_vivo',
      inicioEm: '2026-10-25T10:00:00.000Z',
      fimEm: '2026-10-25T14:00:00.000Z',
      fimOriginalEm: '2026-10-25T13:58:00.000Z',
      lanceInicialCentavos: 1000,
      incrementoMinimoCentavos: 100,
      lanceAtualCentavos: 1200,
      totalLances: 1,
      valorArremateCentavos: null,
    },
    ultimosLances: [
      { seq: 1, pseudonimo: 'Licitante #0a0b0c', valorCentavos: 1200, criadoEm: INSTANTE },
    ],
    agoraServidor: INSTANTE,
  };
  return usuarioId === undefined
    ? base
    : { ...base, seuPseudonimo: 'Licitante #a1b2c3', suaPosicao: 'superado' };
}

async function subirApp(): Promise<{
  app: NestFastifyApplication;
  url: string;
  montar: MockInstance<MontadorDoEstado['montar']>;
}> {
  const app = await criarAppDeTeste();
  const montar = vi
    .spyOn(app.get(MontadorDoEstado), 'montar')
    .mockImplementation((loteId, usuarioId) => Promise.resolve(estado(loteId, usuarioId)));
  await app.listen({ port: 0, host: '127.0.0.1' });
  apps.push(app);
  const { port } = app.getHttpServer().address() as AddressInfo;
  return { app, url: `http://127.0.0.1:${String(port)}/leilao`, montar };
}

async function conectado(url: string, usuarioId?: string): Promise<Socket> {
  const extraHeaders: Record<string, string> = { Origin: ENV_DE_TESTE.WEB_ORIGIN };
  if (usuarioId !== undefined) {
    const token = await emitirAccessToken(ENV_DE_TESTE.segredos.chaveJwt, {
      id: usuarioId,
      papel: 'licitante',
    });
    extraHeaders['Cookie'] = `access_token=${token}`;
  }
  const socket = io(url, {
    transports: ['websocket'],
    extraHeaders,
    reconnection: false,
    forceNew: true,
  });
  sockets.push(socket);
  await new Promise<void>((resolver, rejeitar) => {
    const prazo = setTimeout(() => rejeitar(new Error('sem connect')), ESPERA_MS);
    socket.once('connect', () => {
      clearTimeout(prazo);
      resolver();
    });
  });
  return socket;
}

async function entrar(socket: Socket, loteId: string): Promise<Ack> {
  return (await socket.timeout(ESPERA_MS).emitWithAck('entrar_lote', { loteId })) as Ack;
}

/** Garante que os eventos sem ack enviados antes já foram tratados (eventos chegam em ordem). */
async function sincronizar(socket: Socket): Promise<void> {
  await socket.timeout(ESPERA_MS).emitWithAck('entrar_lote', {});
}

/** Tudo o que o socket recebe do servidor, na ordem. */
function gravar(socket: Socket): { evento: string; payload: unknown }[] {
  const recebidos: { evento: string; payload: unknown }[] = [];
  socket.onAny((evento: string, payload: unknown) => {
    recebidos.push({ evento, payload });
  });
  return recebidos;
}

function silencio(): Promise<void> {
  return new Promise((resolver) => setTimeout(resolver, SILENCIO_MS));
}

async function ate(condicao: () => boolean): Promise<void> {
  const limite = Date.now() + ESPERA_MS;
  while (!condicao()) {
    if (Date.now() > limite) throw new Error('condição não atingida a tempo');
    await new Promise((resolver) => setTimeout(resolver, 10));
  }
}

function salasDe(app: NestFastifyApplication): Map<string, Set<string>> {
  const gateway = app.get(GatewayDoLeilao) as unknown as {
    namespace: { adapter: { rooms: Map<string, Set<string>> } };
  };
  return gateway.namespace.adapter.rooms;
}

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  for (const app of apps.splice(0)) await app.close();
  vi.restoreAllMocks();
});

describe('ack de entrar_lote', () => {
  it('valida o asyncapi 0.3.0', () => {
    expect(versaoDoAsyncapi()).toBe('0.3.0');
  });

  it('anônimo recebe o estado sem seuPseudonimo nem suaPosicao', async () => {
    const { url, montar } = await subirApp();
    const loteId = randomUUID();
    const socket = await conectado(url);

    const ack = await entrar(socket, loteId);

    validarAckDeEntrada(ack);
    expect(ack).toEqual({ sucesso: true, estado: estado(loteId, undefined) });
    expect(montar).toHaveBeenCalledWith(loteId, undefined);
  });

  it('autenticado recebe seuPseudonimo e suaPosicao, sem id do usuário', async () => {
    const { url, montar } = await subirApp();
    const loteId = randomUUID();
    const usuarioId = randomUUID();
    const socket = await conectado(url, usuarioId);

    const ack = await entrar(socket, loteId);

    validarAckDeEntrada(ack);
    expect(ack).toEqual({ sucesso: true, estado: estado(loteId, usuarioId) });
    expect(montar).toHaveBeenCalledWith(loteId, usuarioId);
    expect(JSON.stringify(ack)).not.toContain(usuarioId);
  });

  it('loteId em maiúsculas usa o mesmo room e o mesmo lote que em minúsculas', async () => {
    const { app, url, montar } = await subirApp();
    const loteId = randomUUID();
    const socket = await conectado(url);

    await entrar(socket, loteId.toUpperCase());

    expect(montar).toHaveBeenCalledWith(loteId, undefined);
    expect(salasDe(app).get(`lote:${loteId}`)?.size).toBe(1);
  });

  it('lote inexistente → NAO_ENCONTRADO e o socket fica fora do room', async () => {
    const { app, url, montar } = await subirApp();
    montar.mockResolvedValue(null);
    const loteId = randomUUID();
    const socket = await conectado(url);

    const ack = await entrar(socket, loteId);

    validarAckDeEntrada(ack);
    expect(ack.erro?.codigo).toBe('NAO_ENCONTRADO');
    expect(salasDe(app).has(`lote:${loteId}`)).toBe(false);
  });

  it('falha na montagem → INDISPONIVEL e o socket fica fora do room', async () => {
    const { app, url, montar } = await subirApp();
    montar.mockRejectedValue(new Error('banco fora'));
    const loteId = randomUUID();
    const socket = await conectado(url);

    const ack = await entrar(socket, loteId);

    validarAckDeEntrada(ack);
    expect(ack.erro?.codigo).toBe('INDISPONIVEL');
    expect(salasDe(app).has(`lote:${loteId}`)).toBe(false);
  });

  it('resync que falha mantém o socket no room em que já estava', async () => {
    const { app, url, montar } = await subirApp();
    const loteId = randomUUID();
    const socket = await conectado(url);
    await entrar(socket, loteId);
    montar.mockRejectedValue(new Error('banco fora'));

    const ack = await entrar(socket, loteId);

    expect(ack.erro?.codigo).toBe('INDISPONIVEL');
    expect(salasDe(app).get(`lote:${loteId}`)?.size).toBe(1);
  });

  it('reconexão: refazer entrar_lote devolve o estado atual do servidor', async () => {
    const { url, montar } = await subirApp();
    const loteId = randomUUID();
    const usuarioId = randomUUID();
    const primeiro = await conectado(url, usuarioId);
    await entrar(primeiro, loteId);
    primeiro.close();
    const atual = { ...estado(loteId, usuarioId), suaPosicao: 'ganhando' as const };
    montar.mockResolvedValue(atual);

    const segundo = await conectado(url, usuarioId);
    const ack = await entrar(segundo, loteId);

    expect(ack).toEqual({ sucesso: true, estado: atual });
  });
});

describe('difusão dos eventos por room', () => {
  it('lance_aceito e fim_estendido chegam a lote:{id} e vitrine, não a outro lote', async () => {
    const { app, url } = await subirApp();
    const loteId = randomUUID();
    const naSala = await conectado(url);
    const naVitrine = await conectado(url);
    const emOutroLote = await conectado(url);
    await entrar(naSala, loteId);
    await entrar(emOutroLote, randomUUID());
    naVitrine.emit('entrar_vitrine');
    await sincronizar(naVitrine);
    const [sala, vitrine, outro] = [naSala, naVitrine, emOutroLote].map(gravar);
    const lance = {
      loteId,
      seq: 2,
      pseudonimo: 'Licitante #a1b2c3',
      valorCentavos: 1300,
      criadoEm: INSTANTE,
      fimEm: INSTANTE,
      totalLances: 2,
    };

    app.get(PublicadorDeEventos).publicar({ tipo: 'lance_aceito', payload: lance });
    app.get(PublicadorDeEventos).publicar({
      tipo: 'fim_estendido',
      payload: { loteId, fimEm: INSTANTE },
    });
    await ate(() => sala?.length === 2 && vitrine?.length === 2);
    await silencio();

    const esperado = [
      { evento: 'lance_aceito', payload: lance },
      { evento: 'fim_estendido', payload: { loteId, fimEm: INSTANTE } },
    ];
    expect(sala).toEqual(esperado);
    expect(vitrine).toEqual(esperado);
    expect(outro).toEqual([]);
    for (const { evento, payload } of esperado) validarEvento(evento, payload);
  });

  it('privado chega só ao usuario:{id} certo; anônimo e outro usuário não recebem', async () => {
    const { app, url } = await subirApp();
    const loteId = randomUUID();
    const destinatario = randomUUID();
    const conexoes = [
      await conectado(url, destinatario),
      await conectado(url, randomUUID()),
      await conectado(url),
    ];
    for (const socket of conexoes) await entrar(socket, loteId);
    const [doDestinatario, doOutro, doAnonimo] = conexoes.map(gravar);
    const saldo = { totalCentavos: 5000, comprometidoCentavos: 1300, disponivelCentavos: 3700 };

    const publicador = app.get(PublicadorDeEventos);
    publicador.publicar({
      tipo: 'voce_foi_superado',
      payload: { loteId, valorCentavos: 1300 },
      usuarioId: destinatario,
    });
    publicador.publicar({ tipo: 'saldo_atualizado', payload: saldo, usuarioId: destinatario });
    // Privado sem destinatário: descartado, não difundido a ninguém.
    publicador.publicar({ tipo: 'saldo_atualizado', payload: saldo });
    await ate(() => doDestinatario?.length === 2);
    await silencio();

    expect(doDestinatario).toEqual([
      { evento: 'voce_foi_superado', payload: { loteId, valorCentavos: 1300 } },
      { evento: 'saldo_atualizado', payload: saldo },
    ]);
    expect(doOutro).toEqual([]);
    expect(doAnonimo).toEqual([]);
  });
});
