// QA do tempo real ponta a ponta (tarefa 090, specs/009): servidor Nest real na porta 0, Postgres e
// Redis reais, `socket.io-client` e lances pelo POST real. Cobre o que os testes da 083 não cobrem:
// privacidade por usuário (privado só ao destinatário, em qualquer aba, e nunca ao anônimo nem à
// vitrine), latência do POST ao evento (relatório), queda e volta com o estado do novo
// `entrar_lote` igual ao do servidor, só websocket, os limites reais (50 por lote, 200 no total) e
// nenhum evento quando um lance real é recusado dentro da transação.
import pg from 'pg';
import type { Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { registrarChaveDeAssinatura } from '../../src/modules/lances/index.js';
import { EVENTOS_PRIVADOS } from '../../src/modules/tempo-real/difusao-de-eventos.js';
import { MontadorDoEstado } from '../../src/modules/tempo-real/estado-da-sala.js';
import { LIMITES_PADRAO } from '../../src/modules/tempo-real/limites.js';
import {
  aguardarApos,
  ate,
  ColecaoDeSockets,
  doLote,
  ESPERA_MS,
  entrarNaVitrine,
  entrarNoLote,
  entrarNoLoteComSucesso,
  esperarEvento,
  gravar,
  nomesDe,
  ORIGEM_DO_TESTE,
  pausa,
  type Recebido,
  SILENCIO_MS,
  seqsDeLanceAceito,
  TIMEOUT_LONGO_MS,
} from '../helpers/cliente-socket.js';
import { dadosDosUsuarios, terminarEm } from '../helpers/lances-por-sql.js';
import { inserirUsuario } from '../helpers/lotes-por-sql.js';
import {
  type AppDeIdentidade,
  BANCO,
  criarAppDeIdentidade,
  INFRA_DISPONIVEL,
} from '../modules/identidade/ambiente.js';
import { validarEvento } from '../modules/tempo-real/contrato-asyncapi.js';
import {
  type ApoioDeLances,
  type Conta,
  criarApoioDeLances,
  erro,
  INCREMENTO_CENTAVOS,
  LANCE_INICIAL_CENTAVOS,
} from './apoio-de-lances.js';

/** Limites do contrato (specs/009 RNF-02); o teste confere que o servidor ainda os usa. */
const LIMITE_POR_LOTE_DO_CONTRATO = 50;
const LIMITE_TOTAL_DO_CONTRATO = 200;
const { porLote: LIMITE_POR_LOTE, total: LIMITE_TOTAL } = LIMITES_PADRAO;
/** Specs/009: o evento chega em menos de 1 s; vale para o p95 (o máximo sofre com GC e carga). */
const LATENCIA_P95_MAXIMA_MS = 1_000;
/** Mediana em processo (POST, transação e difusão): folga grande sobre o que se mede, e apertada. */
const LATENCIA_MEDIANA_MAXIMA_MS = 250;
const LANCES_DE_AQUECIMENTO = 2;
const LANCES_MEDIDOS = 30;
/**
 * O lance tem limite de 10 por segundo por usuário (specs/007 RNF-02, ADR 0031 D6). Os dois
 * licitantes se alternam, então cada um lança a cada 2 × este intervalo (≤ 5 por segundo).
 */
const INTERVALO_ENTRE_LANCES_MS = 120;
/** Cobre o lance inicial mas não o seguinte (inicial + incremento): recusa por saldo insuficiente. */
const SALDO_DO_RECUSADO_CENTAVOS = LANCE_INICIAL_CENTAVOS;
/** Mensagem do `connect_error` do cliente quando o servidor responde 400 ao polling. */
const MENSAGEM_DO_POLLING_RECUSADO = 'xhr poll error';
/** Dentro dos 2 min do anti-sniping: o primeiro lance estende o fim. */
const FIM_PROXIMO_MS = 90_000;
const INTERVALO_DE_ENTRADA_MS = 150;

interface Servidor {
  readonly ctx: AppDeIdentidade;
  readonly pool: pg.Pool;
  readonly apoio: ApoioDeLances;
  readonly sockets: ColecaoDeSockets;
  /** Origem HTTP do servidor (sem o namespace). */
  readonly raiz: string;
  fechar(): Promise<void>;
}

/** Roda cada passo mesmo que um anterior falhe; junta as falhas num `AggregateError`. */
async function fecharEmPassos(passos: readonly (() => void | Promise<void>)[]): Promise<void> {
  const falhas: unknown[] = [];
  for (const passo of passos) {
    try {
      await passo();
    } catch (falha) {
      falhas.push(falha);
    }
  }
  if (falhas.length > 0) throw new AggregateError(falhas, 'falha ao fechar o servidor de teste');
}

async function subirServidor(): Promise<Servidor> {
  const ctx = await criarAppDeIdentidade({ webOrigin: ORIGEM_DO_TESTE });
  const pool = new pg.Pool(BANCO.conexao());
  let sockets: ColecaoDeSockets | undefined;
  const fechar = (): Promise<void> =>
    fecharEmPassos([() => sockets?.fecharTodos(), () => pool.end(), () => ctx.fechar()]);
  try {
    await registrarChaveDeAssinatura(ctx.app);
    await ctx.app.listen({ port: 0, host: '127.0.0.1' });
    const endereco = ctx.app.getHttpServer().address();
    if (endereco === null || typeof endereco === 'string') {
      throw new Error('o servidor não expôs uma porta TCP');
    }
    const raiz = `http://127.0.0.1:${String(endereco.port)}`;
    const leiloeiro = await inserirUsuario(pool, 'leiloeiro');
    const coleta = new ColecaoDeSockets(`${raiz}/leilao`);
    sockets = coleta;
    return {
      ctx,
      pool,
      raiz,
      sockets: coleta,
      apoio: criarApoioDeLances(ctx, pool, leiloeiro.id),
      fechar,
    };
  } catch (falha) {
    try {
      await fechar();
    } catch (falhaAoFechar) {
      // As duas falhas ficam visíveis: a de subir (a que importa) vem primeiro na lista.
      throw new AggregateError([falha, falhaAoFechar], 'falha ao subir o servidor e ao limpar', {
        cause: falhaAoFechar,
      });
    }
    throw falha;
  }
}

/**
 * Sobe um servidor para o grupo de testes e o derruba no fim. `servidor()` falha com mensagem clara
 * se o setup não terminou (em vez de um `undefined` solto).
 */
function servidorDoGrupo(): () => Servidor {
  let srv: Servidor | undefined;
  beforeAll(async () => {
    srv = await subirServidor();
  }, TIMEOUT_LONGO_MS);
  afterEach(() => {
    srv?.sockets.fecharTodos();
  });
  afterAll(async () => {
    await srv?.fechar();
  }, TIMEOUT_LONGO_MS);
  return () => {
    if (srv === undefined) throw new Error('o servidor do grupo não subiu');
    return srv;
  };
}

const comCookie = (quem: Conta): { cookie: string } => ({
  cookie: quem.cabecalhos['cookie'] ?? '',
});

function tres(contas: readonly Conta[]): [Conta, Conta, Conta] {
  const [a, b, c] = contas;
  if (a === undefined || b === undefined || c === undefined) throw new Error('contas');
  return [a, b, c];
}

function dois(contas: readonly Conta[]): [Conta, Conta] {
  const [a, b] = contas;
  if (a === undefined || b === undefined) throw new Error('contas');
  return [a, b];
}

/** Conecta (com a conta, ou anônimo) e entra no lote; devolve o socket já na sala. */
async function entrarComo(
  sockets: ColecaoDeSockets,
  quem: Conta | undefined,
  loteId: string,
): Promise<Socket> {
  const socket = await sockets.conectar(quem === undefined ? {} : comCookie(quem));
  await entrarNoLoteComSucesso(socket, loteId);
  return socket;
}

function percentil(valores: readonly number[], p: number): number {
  const ordenados = [...valores].sort((x, y) => x - y);
  return ordenados[Math.min(ordenados.length - 1, Math.ceil(p * ordenados.length) - 1)] ?? 0;
}

describe.skipIf(!INFRA_DISPONIVEL)('tempo real: privacidade, latência, resync e transporte', () => {
  const servidor = servidorDoGrupo();

  async function lancar(quem: Conta, loteId: string, valor: number): Promise<void> {
    expect((await servidor().apoio.lancar(quem, loteId, valor)).statusCode).toBe(201);
  }

  async function saldoNoBanco(userId: string): Promise<Record<string, number>> {
    const { rows } = await servidor().pool.query<{ total: string; comprometido: string }>(
      `select total_centavos::text as total, comprometido_centavos::text as comprometido
         from wallet_balances where user_id = $1`,
      [userId],
    );
    const total = Number(rows[0]?.total);
    const comprometido = Number(rows[0]?.comprometido);
    return {
      totalCentavos: total,
      comprometidoCentavos: comprometido,
      disponivelCentavos: total - comprometido,
    };
  }

  /** Nada que identifique as contas (id, nome ou e-mail) aparece em nenhum payload recebido. */
  async function semDadosDeUsuario(
    recebidos: readonly Recebido[],
    contas: readonly Conta[],
  ): Promise<void> {
    const dados = await dadosDosUsuarios(
      servidor().pool,
      contas.map((c) => c.id),
    );
    const texto = JSON.stringify(recebidos.map((r) => r.payload));
    for (const proibido of dados.flatMap((d) => [d.id, d.nome, d.email])) {
      expect(texto).not.toContain(proibido);
    }
  }

  describe('privacidade por usuário', () => {
    interface Cenario {
      readonly a: Conta;
      readonly b: Conta;
      readonly c: Conta;
      readonly loteId: string;
      readonly deA: Recebido[];
      readonly deAEmOutraAba: Recebido[];
      readonly deB: Recebido[];
      readonly deC: Recebido[];
      readonly doAnonimo: Recebido[];
      readonly daVitrine: () => Recebido[];
      readonly daVitrineBruta: Recebido[];
    }

    /** A lidera com 1000. Conectados: A (sala), A (outra aba, fora do lote), B, C, anônimo, vitrine. */
    async function montarCenario(): Promise<Cenario> {
      const srv = servidor();
      const [a, b, c] = tres(await srv.apoio.licitantesComSaldo(3));
      const loteId = await srv.apoio.lote();
      await lancar(a, loteId, LANCE_INICIAL_CENTAVOS);
      const { sockets } = srv;
      const abaDeA = await sockets.conectar(comCookie(a));
      const outraAbaDeA = await sockets.conectar(comCookie(a));
      const deB = await sockets.conectar(comCookie(b));
      const deC = await sockets.conectar(comCookie(c));
      const anonimo = await sockets.conectar();
      const naVitrine = await sockets.conectar();
      for (const socket of [abaDeA, deB, deC, anonimo])
        await entrarNoLoteComSucesso(socket, loteId);
      await entrarNaVitrine(naVitrine);
      const daVitrineBruta = gravar(naVitrine);
      return {
        a,
        b,
        c,
        loteId,
        deA: gravar(abaDeA),
        deAEmOutraAba: gravar(outraAbaDeA),
        deB: gravar(deB),
        deC: gravar(deC),
        doAnonimo: gravar(anonimo),
        daVitrineBruta,
        daVitrine: () => doLote(daVitrineBruta, loteId),
      };
    }

    it(
      'público em lote e vitrine com o payload do asyncapi; privado só ao destinatário',
      async () => {
        const k = await montarCenario();

        await lancar(k.b, k.loteId, LANCE_INICIAL_CENTAVOS + INCREMENTO_CENTAVOS);
        await ate(
          () =>
            k.deA.length >= 3 &&
            k.deAEmOutraAba.length >= 2 &&
            k.deB.length >= 2 &&
            k.deC.length >= 1 &&
            k.doAnonimo.length >= 1 &&
            k.daVitrine().length >= 1,
          { descricao: 'eventos do primeiro lance' },
        );
        await pausa(SILENCIO_MS);

        expect(nomesDe(k.deA)).toEqual(['lance_aceito', 'saldo_atualizado', 'voce_foi_superado']);
        // A outra aba de A nunca entrou no lote: só o room privado `usuario:{id}` a alcança.
        expect(nomesDe(k.deAEmOutraAba)).toEqual(['saldo_atualizado', 'voce_foi_superado']);
        expect(nomesDe(k.deB)).toEqual(['lance_aceito', 'saldo_atualizado']);
        expect(nomesDe(k.deC)).toEqual(['lance_aceito']);
        expect(nomesDe(k.doAnonimo)).toEqual(['lance_aceito']);
        expect(nomesDe(k.daVitrine())).toEqual(['lance_aceito']);
        const aceito = (r: readonly Recebido[]): unknown =>
          r.find((e) => e.evento === 'lance_aceito')?.payload;
        expect(aceito(k.deA)).toMatchObject({
          loteId: k.loteId,
          seq: 2,
          valorCentavos: LANCE_INICIAL_CENTAVOS + INCREMENTO_CENTAVOS,
          totalLances: 2,
          pseudonimo: expect.stringMatching(/^Licitante #[0-9a-f]{6}$/) as string,
        });
        for (const outro of [k.deB, k.deC, k.doAnonimo, k.daVitrine()]) {
          expect(aceito(outro)).toEqual(aceito(k.deA));
        }
        const saldo = (r: readonly Recebido[]): unknown =>
          r.find((e) => e.evento === 'saldo_atualizado')?.payload;
        expect(saldo(k.deB)).toEqual(await saldoNoBanco(k.b.id));
        expect(saldo(k.deA)).toEqual(await saldoNoBanco(k.a.id));
        expect(saldo(k.deAEmOutraAba)).toEqual(saldo(k.deA));
        expect(saldo(k.deB)).toMatchObject({
          comprometidoCentavos: LANCE_INICIAL_CENTAVOS + INCREMENTO_CENTAVOS,
        });
        expect(saldo(k.deA)).toMatchObject({ comprometidoCentavos: 0 });
        const todos = [...k.deA, ...k.deAEmOutraAba, ...k.deB, ...k.deC, ...k.doAnonimo];
        for (const { evento, payload } of [...todos, ...k.daVitrine()]) {
          validarEvento(evento, payload);
        }
        await semDadosDeUsuario([...todos, ...k.daVitrine()], [k.a, k.b, k.c]);
      },
      TIMEOUT_LONGO_MS,
    );

    it(
      'o privado troca de destinatário a cada lance e a vitrine nunca recebe privado',
      async () => {
        const k = await montarCenario();
        const v1 = LANCE_INICIAL_CENTAVOS + INCREMENTO_CENTAVOS;
        const v2 = LANCE_INICIAL_CENTAVOS + 2 * INCREMENTO_CENTAVOS;
        const v3 = LANCE_INICIAL_CENTAVOS + 3 * INCREMENTO_CENTAVOS;

        // Lance 1 (B supera A): espera todos os destinatários, inclusive C, anônimo e vitrine,
        // antes de marcar o ponto de partida.
        await lancar(k.b, k.loteId, v1);
        await ate(
          () =>
            k.deA.length >= 3 &&
            k.deB.length >= 2 &&
            k.deC.length >= 1 &&
            k.doAnonimo.length >= 1 &&
            k.daVitrine().length >= 1,
          { descricao: 'eventos do primeiro lance chegaram a todos' },
        );
        const antes = {
          a: k.deA.length,
          b: k.deB.length,
          c: k.deC.length,
          anonimo: k.doAnonimo.length,
        };

        // Lances 2 (A supera B) e 3 (B supera A). O lance 3 é o evento-barreira: tudo o que o
        // lance 2 tinha de mandar já foi mandado antes dele, e a ordem por conexão se mantém.
        await lancar(k.a, k.loteId, v2);
        await lancar(k.b, k.loteId, v3);
        await Promise.all([
          esperarEvento(k.deA, 'voce_foi_superado', 'valorCentavos', v3),
          esperarEvento(k.deB, 'lance_aceito', 'seq', 4),
          esperarEvento(k.deC, 'lance_aceito', 'seq', 4),
          esperarEvento(k.doAnonimo, 'lance_aceito', 'seq', 4),
          esperarEvento(k.daVitrine, 'lance_aceito', 'seq', 4),
        ]);
        await pausa(SILENCIO_MS);

        const dosLances2e3 = [
          'lance_aceito',
          'lance_aceito',
          'saldo_atualizado',
          'saldo_atualizado',
        ];
        expect(nomesDe(k.deA.slice(antes.a))).toEqual([...dosLances2e3, 'voce_foi_superado']);
        expect(nomesDe(k.deB.slice(antes.b))).toEqual([...dosLances2e3, 'voce_foi_superado']);
        expect(nomesDe(k.deC.slice(antes.c))).toEqual(['lance_aceito', 'lance_aceito']);
        expect(nomesDe(k.doAnonimo.slice(antes.anonimo))).toEqual(['lance_aceito', 'lance_aceito']);
        // O privado troca de destinatário: A foi superada nos lances 1 e 3; B só no 2.
        const superados = (r: readonly Recebido[]): unknown[] =>
          r.filter((e) => e.evento === 'voce_foi_superado').map((e) => e.payload);
        expect(superados(k.deA)).toEqual([
          { loteId: k.loteId, valorCentavos: v1 },
          { loteId: k.loteId, valorCentavos: v3 },
        ]);
        expect(superados(k.deB)).toEqual([{ loteId: k.loteId, valorCentavos: v2 }]);
        // C e o anônimo nunca recebem privado; a vitrine, de qualquer lote, também não.
        const privados: readonly string[] = EVENTOS_PRIVADOS;
        for (const publico of [k.deC, k.doAnonimo, k.daVitrineBruta]) {
          expect(publico.filter((e) => privados.includes(e.evento))).toEqual([]);
        }
        expect(seqsDeLanceAceito(k.daVitrine())).toEqual([2, 3, 4]);
      },
      TIMEOUT_LONGO_MS,
    );
  });

  describe('latência', () => {
    it(
      'do POST ao evento recebido: relatório (p50, p95, máximo) e p95 abaixo de 1 s',
      async () => {
        const srv = servidor();
        const [a, b] = dois(await srv.apoio.licitantesComSaldo(2));
        const loteId = await srv.apoio.lote();
        const { sockets } = srv;
        const deA = gravar(await entrarComo(sockets, a, loteId));
        const deB = gravar(await entrarComo(sockets, b, loteId));
        const observador = gravar(await entrarComo(sockets, undefined, loteId));
        const aceito: number[] = [];
        const superado: number[] = [];

        for (let i = 0; i < LANCES_DE_AQUECIMENTO + LANCES_MEDIDOS; i += 1) {
          const valor = LANCE_INICIAL_CENTAVOS + i * INCREMENTO_CENTAVOS;
          const superada = i % 2 === 0 ? deB : deA;
          const medir = i >= LANCES_DE_AQUECIMENTO;
          const t0 = performance.now();
          await lancar(i % 2 === 0 ? a : b, loteId, valor);
          // O lote começa vazio, então o lance `i` tem `seq = i + 1`; o evento é achado por `seq`.
          const chegouAceito = await esperarEvento(observador, 'lance_aceito', 'seq', i + 1);
          if (medir) aceito.push(chegouAceito.em - t0);
          if (i === 0) {
            await pausa(INTERVALO_ENTRE_LANCES_MS);
            continue;
          }
          // O superado carrega o valor do lance que superou, único em todo o laço.
          const chegouSuperado = await esperarEvento(
            superada,
            'voce_foi_superado',
            'valorCentavos',
            valor,
          );
          if (medir) superado.push(chegouSuperado.em - t0);
          await pausa(INTERVALO_ENTRE_LANCES_MS);
        }

        const resumo = (valores: readonly number[]): string =>
          `n=${String(valores.length)} p50=${percentil(valores, 0.5).toFixed(0)} ms ` +
          `p95=${percentil(valores, 0.95).toFixed(0)} ms max=${Math.max(...valores).toFixed(0)} ms`;
        // Relatório: o tempo inclui o POST em processo (inject), a transação e a difusão.
        console.info(`[090] POST → lance_aceito: ${resumo(aceito)}`);
        console.info(`[090] POST → voce_foi_superado: ${resumo(superado)}`);
        expect(aceito).toHaveLength(LANCES_MEDIDOS);
        expect(superado).toHaveLength(LANCES_MEDIDOS);
        for (const amostras of [aceito, superado]) {
          expect(percentil(amostras, 0.95)).toBeLessThan(LATENCIA_P95_MAXIMA_MS);
          expect(percentil(amostras, 0.5)).toBeLessThan(LATENCIA_MEDIANA_MAXIMA_MS);
        }
        for (const { evento, payload } of [...deA, ...deB, ...observador]) {
          validarEvento(evento, payload);
        }
      },
      TIMEOUT_LONGO_MS,
    );
  });

  describe('queda e volta', () => {
    it(
      'o novo entrar_lote devolve o estado do servidor; nada do intervalo é reenviado nem duplicado',
      async () => {
        const srv = servidor();
        const [a, b, c] = tres(await srv.apoio.licitantesComSaldo(3));
        const loteId = await srv.apoio.lote();
        await terminarEm(srv.pool, loteId, FIM_PROXIMO_MS);
        await lancar(a, loteId, LANCE_INICIAL_CENTAVOS);
        const socket = await srv.sockets.conectar(comCookie(a));
        const antes = await entrarNoLoteComSucesso(socket, loteId);
        expect(antes.estado.suaPosicao).toBe('ganhando');
        const recebidos = gravar(socket);

        await aguardarApos(socket, 'disconnect', () => {
          socket.io.engine.close();
        });
        // Com A fora, B e C disputam e o fim é estendido (anti-sniping).
        await lancar(b, loteId, LANCE_INICIAL_CENTAVOS + INCREMENTO_CENTAVOS);
        await lancar(c, loteId, LANCE_INICIAL_CENTAVOS + 2 * INCREMENTO_CENTAVOS);
        await aguardarApos(socket, 'connect', () => {
          socket.connect();
        });
        await pausa(SILENCIO_MS);
        expect(recebidos).toEqual([]);

        const ack = await entrarNoLoteComSucesso(socket, loteId);
        const doServidor = await srv.ctx.app.get(MontadorDoEstado).montar(loteId, a.id);

        // Só `agoraServidor` difere: é o relógio lido em cada montagem.
        const semRelogio = (estado: object | null): unknown => ({ ...estado, agoraServidor: '-' });
        expect(semRelogio(ack.estado)).toEqual(semRelogio(doServidor));
        expect(ack.estado.suaPosicao).toBe('superado');
        const lote = ack.estado['lote'] as { totalLances: number; lanceAtualCentavos: number };
        expect(lote).toMatchObject({
          totalLances: 3,
          lanceAtualCentavos: LANCE_INICIAL_CENTAVOS + 2 * INCREMENTO_CENTAVOS,
        });
        expect(ack.estado['ultimosLances']).toMatchObject([{ seq: 3 }, { seq: 2 }, { seq: 1 }]);
        const fimDe = (s: { estado: Readonly<Record<string, unknown>> }): number =>
          Date.parse((s.estado['lote'] as { fimEm: string }).fimEm);
        expect(fimDe(ack)).toBeGreaterThan(fimDe(antes));

        // Depois do resync, o próximo evento continua a sequência do ack, sem buraco nem repetição.
        await lancar(b, loteId, LANCE_INICIAL_CENTAVOS + 3 * INCREMENTO_CENTAVOS);
        const aceito = await esperarEvento(recebidos, 'lance_aceito', 'seq', 4);
        await pausa(SILENCIO_MS);
        // Perto do fim, o lance estende o prazo de novo: `fim_estendido` é o único outro evento.
        expect(nomesDe(recebidos).filter((nome) => nome !== 'fim_estendido')).toEqual([
          'lance_aceito',
        ]);
        expect(aceito.payload).toMatchObject({ loteId, seq: 4, totalLances: 4 });
        for (const { evento, payload } of recebidos) validarEvento(evento, payload);
      },
      TIMEOUT_LONGO_MS,
    );
  });

  describe('transporte', () => {
    it(
      'só websocket: polling é recusado e a conexão usa o transporte websocket',
      async () => {
        const srv = servidor();
        const resposta = await fetch(`${srv.raiz}/socket.io/?EIO=4&transport=polling`, {
          headers: { Origin: ORIGEM_DO_TESTE },
          signal: AbortSignal.timeout(ESPERA_MS),
        });
        expect(resposta.status).toBe(400);

        const comPolling = await srv.sockets.tentar({ transports: ['polling'] });
        expect(comPolling.erro).toBe(MENSAGEM_DO_POLLING_RECUSADO);

        const socket = await srv.sockets.conectar();
        expect(socket.io.engine.transport.name).toBe('websocket');
      },
      TIMEOUT_LONGO_MS,
    );
  });

  describe('nenhum evento sem COMMIT', () => {
    it(
      'lance recusado por SALDO_INSUFICIENTE não emite a nenhum room; o seguinte emite só o esperado',
      async () => {
        const srv = servidor();
        const [lider, concorrente] = dois(await srv.apoio.licitantesComSaldo(2));
        const [recusado] = await srv.apoio.licitantesComSaldo(1, SALDO_DO_RECUSADO_CENTAVOS);
        if (recusado === undefined) throw new Error('conta');
        const loteId = await srv.apoio.lote();
        await lancar(lider, loteId, LANCE_INICIAL_CENTAVOS);
        const valor = LANCE_INICIAL_CENTAVOS + INCREMENTO_CENTAVOS;

        const doLider = gravar(await entrarComo(srv.sockets, lider, loteId));
        const doRecusado = gravar(await entrarComo(srv.sockets, recusado, loteId));
        const doAnonimo = gravar(await entrarComo(srv.sockets, undefined, loteId));
        const naVitrine = await srv.sockets.conectar();
        await entrarNaVitrine(naVitrine);
        const daVitrineBruta = gravar(naVitrine);
        const daVitrine = (): Recebido[] => doLote(daVitrineBruta, loteId);

        // O saldo do recusado (1000) não cobre 1100. A transação já liberou o líder antes de falhar:
        // o ROLLBACK desfaz isso, e nada pode ter saído para ninguém.
        const recusa = await srv.apoio.lancar(recusado, loteId, valor);
        expect(recusa.statusCode).toBe(422);
        expect(erro(recusa).codigo).toBe('SALDO_INSUFICIENTE');

        // O lance aceito logo depois é o evento-barreira: o que a recusa tivesse emitido chegaria antes.
        await lancar(concorrente, loteId, valor);
        await Promise.all([
          esperarEvento(doLider, 'voce_foi_superado', 'valorCentavos', valor),
          esperarEvento(doRecusado, 'lance_aceito', 'seq', 2),
          esperarEvento(doAnonimo, 'lance_aceito', 'seq', 2),
          esperarEvento(daVitrine, 'lance_aceito', 'seq', 2),
        ]);
        await pausa(SILENCIO_MS);

        // A `seq` 2 é do lance aceito: a recusa não consumiu `seq`.
        for (const recebidos of [doLider, doRecusado, doAnonimo, daVitrine()]) {
          expect(seqsDeLanceAceito(recebidos)).toEqual([2]);
        }
        expect(nomesDe(doLider)).toEqual(['lance_aceito', 'saldo_atualizado', 'voce_foi_superado']);
        // O recusado não recebe nem `saldo_atualizado`: a carteira dele não mudou.
        expect(nomesDe(doRecusado)).toEqual(['lance_aceito']);
        expect(nomesDe(doAnonimo)).toEqual(['lance_aceito']);
        expect(nomesDe(daVitrine())).toEqual(['lance_aceito']);
        // O líder anterior não ficou com a liberação da transação desfeita.
        const saldoDoLider = doLider.find((e) => e.evento === 'saldo_atualizado');
        expect(saldoDoLider?.payload).toEqual(await saldoNoBanco(lider.id));
        expect(saldoDoLider?.payload).toMatchObject({ comprometidoCentavos: 0 });
        for (const { evento, payload } of [
          ...doLider,
          ...doRecusado,
          ...doAnonimo,
          ...daVitrine(),
        ]) {
          validarEvento(evento, payload);
        }
      },
      TIMEOUT_LONGO_MS,
    );
  });
});

describe.skipIf(!INFRA_DISPONIVEL)('tempo real: limite de 50 conexões por lote', () => {
  const servidor = servidorDoGrupo();

  it(
    'a 51ª entrada recebe SALA_CHEIA, os 50 recebem cada lance uma vez e a vaga volta ao sair',
    async () => {
      expect(LIMITE_POR_LOTE).toBe(LIMITE_POR_LOTE_DO_CONTRATO);
      const srv = servidor();
      const [licitante] = await srv.apoio.licitantesComSaldo(1);
      if (licitante === undefined) throw new Error('conta');
      const loteId = await srv.apoio.lote();
      const naSala = await Promise.all(
        Array.from({ length: LIMITE_POR_LOTE }, async () => {
          const socket = await srv.sockets.conectar();
          await entrarNoLoteComSucesso(socket, loteId);
          return { socket, recebidos: gravar(socket) };
        }),
      );

      const excedente = await srv.sockets.conectar();
      const recusa = await entrarNoLote(excedente, loteId);
      expect(recusa).toMatchObject({ sucesso: false, erro: { codigo: 'SALA_CHEIA' } });
      const deExcedente = gravar(excedente);

      expect((await srv.apoio.lancar(licitante, loteId, LANCE_INICIAL_CENTAVOS)).statusCode).toBe(
        201,
      );
      await ate(() => naSala.every((s) => s.recebidos.length >= 1), {
        descricao: 'lance_aceito nos 50',
      });
      await pausa(SILENCIO_MS);
      for (const { recebidos } of naSala) {
        expect(nomesDe(recebidos)).toEqual(['lance_aceito']);
        for (const { evento, payload } of recebidos) validarEvento(evento, payload);
      }
      expect(deExcedente).toEqual([]);

      naSala[0]?.socket.emit('sair_lote', { loteId });
      await ate(async () => (await entrarNoLote(excedente, loteId)).sucesso, {
        intervaloMs: INTERVALO_DE_ENTRADA_MS,
        descricao: 'vaga liberada no lote',
      });
    },
    TIMEOUT_LONGO_MS,
  );
});

describe.skipIf(!INFRA_DISPONIVEL)('tempo real: limite de 200 conexões no total', () => {
  const servidor = servidorDoGrupo();

  it(
    'a 201ª conexão é recusada com SERVIDOR_CHEIO e a vaga volta quando uma fecha',
    async () => {
      expect(LIMITE_TOTAL).toBe(LIMITE_TOTAL_DO_CONTRATO);
      const srv = servidor();
      const conectadas: Socket[] = [];
      for (let grupo = 0; grupo < LIMITE_TOTAL / LIMITE_POR_LOTE; grupo += 1) {
        conectadas.push(
          ...(await Promise.all(
            Array.from({ length: LIMITE_POR_LOTE }, () => srv.sockets.conectar()),
          )),
        );
      }
      expect(conectadas).toHaveLength(LIMITE_TOTAL);

      const recusada = await srv.sockets.tentar();
      expect(recusada.erro).toBe('SERVIDOR_CHEIO');

      conectadas[0]?.close();
      await ate(async () => (await srv.sockets.tentar()).erro === undefined, {
        intervaloMs: INTERVALO_DE_ENTRADA_MS,
        descricao: 'vaga liberada no servidor',
      });
    },
    TIMEOUT_LONGO_MS,
  );
});
