// Integração (Postgres e Redis reais) do tempo real (tarefa 083, specs/009): o ack de
// `entrar_lote` nos cinco valores de `suaPosicao` e para o anônimo, validado contra o asyncapi;
// os eventos do lance publicados só depois do COMMIT e nos rooms certos; recusa (rollback) sem
// evento; e o estado depois da reconexão igual ao do servidor. Lances pelo POST real.
import type { AddressInfo } from 'node:net';

import pg from 'pg';
import { io, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { PublicadorDeEventos } from '../../../src/common/eventos/publicador-de-eventos.js';
import { registrarChaveDeAssinatura } from '../../../src/modules/lances/index.js';
import { MontadorDoEstado } from '../../../src/modules/tempo-real/estado-da-sala.js';
import { inserirUsuario } from '../../helpers/lotes-por-sql.js';
import {
  type ApoioDeLances,
  type Conta,
  criarApoioDeLances,
  INCREMENTO_CENTAVOS,
  LANCE_INICIAL_CENTAVOS,
} from '../../integracao/apoio-de-lances.js';
import {
  type AppDeIdentidade,
  BANCO,
  criarAppDeIdentidade,
  INFRA_DISPONIVEL,
} from '../identidade/ambiente.js';
import { validarAckDeEntrada, validarEvento } from './contrato-asyncapi.js';

const ORIGEM = 'http://localhost:15173';
const ESPERA_MS = 5_000;
const SILENCIO_MS = 300;

type Recebido = { readonly evento: string; readonly payload: unknown };
interface AckDeSucesso {
  readonly sucesso: true;
  readonly estado: Record<string, unknown> & { readonly suaPosicao?: string };
}

describe.skipIf(!INFRA_DISPONIVEL)('tempo real: estado e eventos (Postgres e Redis reais)', () => {
  let ctx: AppDeIdentidade;
  let pool: pg.Pool;
  let apoio: ApoioDeLances;
  let url: string;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    ctx = await criarAppDeIdentidade({ webOrigin: ORIGEM });
    await registrarChaveDeAssinatura(ctx.app);
    await ctx.app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = ctx.app.getHttpServer().address() as AddressInfo;
    url = `http://127.0.0.1:${String(port)}/leilao`;
    pool = new pg.Pool(BANCO.conexao());
    const leiloeiro = await inserirUsuario(pool, 'leiloeiro');
    apoio = criarApoioDeLances(ctx, pool, leiloeiro.id);
  });

  afterEach(() => {
    for (const socket of sockets.splice(0)) socket.close();
  });

  afterAll(async () => {
    await pool.end();
    await ctx.fechar();
  });

  async function conectar(quem?: Conta): Promise<Socket> {
    const extraHeaders: Record<string, string> = { Origin: ORIGEM };
    if (quem !== undefined) extraHeaders['Cookie'] = quem.cabecalhos['cookie'] ?? '';
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

  async function entrar(socket: Socket, loteId: string): Promise<AckDeSucesso> {
    const ack: unknown = await socket.timeout(ESPERA_MS).emitWithAck('entrar_lote', { loteId });
    validarAckDeEntrada(ack);
    expect(ack).toMatchObject({ sucesso: true });
    return ack as AckDeSucesso;
  }

  function gravar(socket: Socket): Recebido[] {
    const recebidos: Recebido[] = [];
    socket.onAny((evento: string, payload: unknown) => recebidos.push({ evento, payload }));
    return recebidos;
  }

  async function ate(condicao: () => boolean): Promise<void> {
    const limite = Date.now() + ESPERA_MS;
    while (!condicao()) {
      if (Date.now() > limite) throw new Error('condição não atingida a tempo');
      await new Promise((resolver) => setTimeout(resolver, 10));
    }
  }

  async function lancar(quem: Conta, loteId: string, valor: number): Promise<void> {
    expect((await apoio.lancar(quem, loteId, valor)).statusCode).toBe(201);
  }

  /** Encerra o lote por SQL com o vencedor dado (o job de encerramento é da F4). */
  async function encerrar(loteId: string, vencedorId: string): Promise<void> {
    await pool.query(
      `update lots
          set inicio_em = now() - interval '2 hours',
              fim_original_em = now() - interval '1 minute',
              fim_em = now() - interval '1 minute',
              status = 'encerrado', vencedor_id = $2,
              valor_arremate_centavos = lance_atual_centavos
        where id = $1`,
      [loteId, vencedorId],
    );
  }

  /** Nada que identifique as contas (id, nome ou e-mail) aparece no JSON. */
  async function semDadosDeUsuario(valor: unknown, contas: readonly Conta[]): Promise<void> {
    const ids = contas.map((c) => c.id);
    const { rows } = await pool.query<{ nome: string; email: string }>(
      'select nome, email from users where id = any($1::uuid[])',
      [ids],
    );
    const texto = JSON.stringify(valor);
    for (const proibido of [...ids, ...rows.flatMap((r) => [r.nome, r.email])]) {
      expect(texto).not.toContain(proibido);
    }
  }

  it('ack nos cinco valores de suaPosicao e, para o anônimo, sem pseudônimo nem posição', async () => {
    const [a, b, semLance] = await apoio.licitantesComSaldo(3);
    if (a === undefined || b === undefined || semLance === undefined) throw new Error('contas');
    const aoVivo = await apoio.lote();
    await lancar(a, aoVivo, LANCE_INICIAL_CENTAVOS);
    await lancar(b, aoVivo, LANCE_INICIAL_CENTAVOS + INCREMENTO_CENTAVOS);
    const encerrado = await apoio.lote();
    await lancar(a, encerrado, LANCE_INICIAL_CENTAVOS);
    await lancar(b, encerrado, LANCE_INICIAL_CENTAVOS + INCREMENTO_CENTAVOS);
    await encerrar(encerrado, b.id);

    const casos: readonly [Conta, string, string][] = [
      [b, aoVivo, 'ganhando'],
      [a, aoVivo, 'superado'],
      [b, encerrado, 'venceu'],
      [a, encerrado, 'perdeu'],
      [semLance, aoVivo, 'sem_lance'],
    ];
    for (const [quem, loteId, posicao] of casos) {
      const ack = await entrar(await conectar(quem), loteId);
      expect(ack.estado.suaPosicao).toBe(posicao);
      expect(ack.estado['seuPseudonimo']).toMatch(/^Licitante #[0-9a-f]{6}$/);
      await semDadosDeUsuario(ack, [a, b, semLance]);
    }

    const anonimo = await entrar(await conectar(), encerrado);
    expect(anonimo.estado).not.toHaveProperty('seuPseudonimo');
    expect(anonimo.estado).not.toHaveProperty('suaPosicao');
    expect(anonimo.estado['lote']).toMatchObject({
      id: encerrado,
      status: 'encerrado',
      totalLances: 2,
      lanceAtualCentavos: LANCE_INICIAL_CENTAVOS + INCREMENTO_CENTAVOS,
      valorArremateCentavos: LANCE_INICIAL_CENTAVOS + INCREMENTO_CENTAVOS,
    });
    expect(anonimo.estado['ultimosLances']).toMatchObject([{ seq: 2 }, { seq: 1 }]);
    await semDadosDeUsuario(anonimo, [a, b, semLance]);
  });

  it('autenticado sem lance recebe o mesmo pseudônimo que o lance dele terá (D8)', async () => {
    const [quem] = await apoio.licitantesComSaldo(1);
    if (quem === undefined) throw new Error('conta');
    const loteId = await apoio.lote();
    const antes = await entrar(await conectar(quem), loteId);

    await lancar(quem, loteId, LANCE_INICIAL_CENTAVOS);
    const depois = await entrar(await conectar(quem), loteId);

    expect(antes.estado.suaPosicao).toBe('sem_lance');
    expect(depois.estado['ultimosLances']).toMatchObject([
      { pseudonimo: antes.estado['seuPseudonimo'] },
    ]);
  });

  it('lote inexistente → NAO_ENCONTRADO', async () => {
    const socket = await conectar();
    const ack: unknown = await socket
      .timeout(ESPERA_MS)
      .emitWithAck('entrar_lote', { loteId: '0192f000-0000-7000-8000-00000000dead' });

    validarAckDeEntrada(ack);
    expect(ack).toMatchObject({ sucesso: false, erro: { codigo: 'NAO_ENCONTRADO' } });
  });

  it('lance aceito: eventos depois do COMMIT, nos rooms certos e sem dados de usuário', async () => {
    const [a, b] = await apoio.licitantesComSaldo(2);
    if (a === undefined || b === undefined) throw new Error('contas');
    const loteId = await apoio.lote();
    await lancar(a, loteId, LANCE_INICIAL_CENTAVOS);
    const socketA = await conectar(a);
    const socketB = await conectar(b);
    const anonimo = await conectar();
    const naVitrine = await conectar();
    for (const socket of [socketA, socketB, anonimo]) await entrar(socket, loteId);
    naVitrine.emit('entrar_vitrine');
    await naVitrine.timeout(ESPERA_MS).emitWithAck('entrar_lote', {});
    const deA = gravar(socketA);
    const deB = gravar(socketB);
    const doAnonimo = gravar(anonimo);
    const daVitrine = gravar(naVitrine);
    // No instante da publicação, outra conexão já enxerga o lance: a transação confirmou.
    const visivelNaPublicacao: boolean[] = [];
    const cancelar = ctx.app.get(PublicadorDeEventos).aoOcorrer('lance_aceito', async (p) => {
      const { rowCount } = await pool.query('select 1 from bids where lote_id = $1 and seq = $2', [
        p.loteId,
        p.seq,
      ]);
      visivelNaPublicacao.push(rowCount === 1);
    });

    try {
      await lancar(b, loteId, LANCE_INICIAL_CENTAVOS + INCREMENTO_CENTAVOS);
      await ate(
        () =>
          visivelNaPublicacao.length === 1 &&
          deA.length >= 3 &&
          deB.length >= 2 &&
          doAnonimo.length >= 1 &&
          daVitrine.length >= 1,
      );
      await new Promise((resolver) => setTimeout(resolver, SILENCIO_MS));
    } finally {
      cancelar();
    }

    expect(visivelNaPublicacao).toEqual([true]);
    const nomes = (r: readonly Recebido[]): string[] => r.map((e) => e.evento).sort();
    expect(nomes(deA)).toEqual(['lance_aceito', 'saldo_atualizado', 'voce_foi_superado']);
    expect(nomes(deB)).toEqual(['lance_aceito', 'saldo_atualizado']);
    expect(nomes(doAnonimo)).toEqual(['lance_aceito']);
    expect(nomes(daVitrine)).toEqual(['lance_aceito']);
    for (const { evento, payload } of [...deA, ...deB]) validarEvento(evento, payload);
    expect(deA.find((e) => e.evento === 'voce_foi_superado')?.payload).toEqual({
      loteId,
      valorCentavos: LANCE_INICIAL_CENTAVOS + INCREMENTO_CENTAVOS,
    });
    await semDadosDeUsuario([...doAnonimo, ...daVitrine], [a, b]);
  });

  it('lance recusado (rollback) não publica nenhum evento', async () => {
    const [a, b] = await apoio.licitantesComSaldo(2);
    if (a === undefined || b === undefined) throw new Error('contas');
    const loteId = await apoio.lote();
    await lancar(a, loteId, LANCE_INICIAL_CENTAVOS);
    const ouvinte = await conectar(a);
    await entrar(ouvinte, loteId);
    const recebidos = gravar(ouvinte);

    const recusa = await apoio.lancar(b, loteId, LANCE_INICIAL_CENTAVOS);
    await new Promise((resolver) => setTimeout(resolver, SILENCIO_MS));

    expect(recusa.statusCode).toBeGreaterThanOrEqual(400);
    expect(recebidos).toEqual([]);
  });

  it('reconexão: o estado devolvido é idêntico ao do servidor', async () => {
    const [a, b] = await apoio.licitantesComSaldo(2);
    if (a === undefined || b === undefined) throw new Error('contas');
    const loteId = await apoio.lote();
    await lancar(a, loteId, LANCE_INICIAL_CENTAVOS);
    const primeiro = await conectar(a);
    await entrar(primeiro, loteId);
    primeiro.close();
    // Enquanto A está fora, B o supera.
    await lancar(b, loteId, LANCE_INICIAL_CENTAVOS + INCREMENTO_CENTAVOS);

    const ack = await entrar(await conectar(a), loteId);
    const servidor = await ctx.app.get(MontadorDoEstado).montar(loteId, a.id);

    // Só `agoraServidor` difere: é o relógio lido em cada montagem.
    const semRelogio = (estado: object | null): unknown => ({ ...estado, agoraServidor: '-' });
    expect(semRelogio(ack.estado)).toEqual(semRelogio(servidor));
    expect(ack.estado.suaPosicao).toBe('superado');
    expect(ack.estado['lote']).toMatchObject({ totalLances: 2 });
  });
});
