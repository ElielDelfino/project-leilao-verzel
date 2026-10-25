// Agendador de 1 s com Postgres e Redis reais (tarefa 107; specs/010). O banco, o Redis e o
// barramento são compartilhados com outros arquivos de teste em paralelo: o serviço de
// encerramento usado aqui só encerra os lotes deste arquivo (os demais vencidos falham de
// propósito e caem no backoff, sem ocupar o LIMIT da varredura), e os eventos são filtrados pelo
// `loteId` de cada cenário.
import { Logger } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { EventoDeDominio } from '../../../../src/common/eventos/publicador-de-eventos.js';
import { PublicadorDeEventos } from '../../../../src/common/eventos/publicador-de-eventos.js';
import { BANCO as TOKEN_DO_BANCO } from '../../../../src/config/banco.module.js';
import type { Banco } from '../../../../src/db/banco.js';
import { registrarChaveDeAssinatura } from '../../../../src/modules/lances/index.js';
import { AgendadorDoEncerramento } from '../../../../src/modules/liquidacao/agendador/agendador-do-encerramento.js';
import { ServicoDeEncerramento } from '../../../../src/modules/liquidacao/index.js';
import { ate, TIMEOUT_LONGO_MS } from '../../../helpers/cliente-socket.js';
import { encerrarPorSql } from '../../../helpers/lances-por-sql.js';
import { inserirLote, inserirUsuario, iso } from '../../../helpers/lotes-por-sql.js';
import { criarApoioDeLances, type ApoioDeLances } from '../../../integracao/apoio-de-lances.js';
import { exigirCarteiraReconciliada } from '../../../integracao/reconciliacao.js';
import {
  type AppDeIdentidade,
  BANCO,
  criarAppDeIdentidade,
  INFRA_DISPONIVEL,
} from '../../identidade/ambiente.js';

const LIMITE_DO_ENCERRAMENTO_MS = 2_000;
const AMOSTRAS_DE_ATRASO = 10;
const HORA_MS = 60 * 60 * 1000;

/** Encerra só os lotes `meus` e falha de propósito nos `venenos` e nos lotes de outros testes. */
function servicoRestrito(
  real: ServicoDeEncerramento,
  meus: ReadonlySet<string>,
  venenos: ReadonlySet<string>,
): ServicoDeEncerramento {
  const encerrar = (id: string): ReturnType<ServicoDeEncerramento['encerrar']> => {
    if (!meus.has(id) || venenos.has(id)) return Promise.reject(new Error('fora deste teste'));
    return real.encerrar(id);
  };
  return { encerrar } as unknown as ServicoDeEncerramento;
}

describe.skipIf(!INFRA_DISPONIVEL)('AgendadorDoEncerramento (Postgres e Redis reais)', () => {
  let ctx: AppDeIdentidade;
  let pool: pg.Pool;
  let real: ServicoDeEncerramento;
  let apoio: ApoioDeLances;
  let leiloeiroId: string;
  const eventos: EventoDeDominio[] = [];
  const desligar: (() => void)[] = [];
  const agendadores: AgendadorDoEncerramento[] = [];
  const sobras: string[] = [];

  beforeAll(async () => {
    ctx = await criarAppDeIdentidade();
    await registrarChaveDeAssinatura(ctx.app);
    pool = new pg.Pool(BANCO.conexao());
    real = ctx.app.get(ServicoDeEncerramento);
    leiloeiroId = (await inserirUsuario(pool, 'leiloeiro')).id;
    apoio = criarApoioDeLances(ctx, pool, leiloeiroId);
    const publicador = ctx.app.get(PublicadorDeEventos);
    for (const tipo of ['lote_iniciado', 'lote_encerrado'] as const) {
      desligar.push(
        publicador.aoOcorrer(tipo, (payload) => {
          eventos.push({ tipo, payload } as EventoDeDominio);
        }),
      );
    }
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  }, TIMEOUT_LONGO_MS);

  afterEach(async () => {
    vi.useRealTimers();
    await Promise.all(agendadores.splice(0).map((a) => a.parar()));
    const pendentes = sobras.splice(0);
    if (pendentes.length === 0) return;
    // Lote vencido que o teste não encerrou ficaria como veneno no banco compartilhado.
    await pool.query(
      `update lots
          set inicio_em = now() - interval '2 hours',
              fim_original_em = now() + interval '1 day',
              fim_em = now() + interval '1 day'
        where id = any($1::uuid[]) and status = 'ao_vivo'`,
      [pendentes],
    );
  });

  afterAll(async () => {
    desligar.forEach((f) => {
      f();
    });
    vi.restoreAllMocks();
    const poolAberto = pool as pg.Pool | undefined;
    const appAberto = ctx as AppDeIdentidade | undefined;
    try {
      await poolAberto?.end();
    } finally {
      await appAberto?.fechar();
    }
  });

  function criar(meus: Iterable<string>, venenos: Iterable<string> = []): AgendadorDoEncerramento {
    const agendador = new AgendadorDoEncerramento(
      ctx.app.get<Banco>(TOKEN_DO_BANCO),
      ctx.app.get(PublicadorDeEventos),
      servicoRestrito(real, new Set(meus), new Set(venenos)),
      new SchedulerRegistry(),
    );
    agendadores.push(agendador);
    return agendador;
  }

  async function statusDe(loteId: string): Promise<string> {
    const { rows } = await pool.query<{ status: string }>(`select status from lots where id = $1`, [
      loteId,
    ]);
    return rows[0]?.status ?? 'inexistente';
  }

  async function loteQueVenceEm(ms: number): Promise<string> {
    const { id } = await inserirLote(pool, leiloeiroId, {
      lance_inicial_centavos: 1000,
      incremento_minimo_centavos: 100,
    });
    await pool.query(
      `update lots
          set inicio_em = fim.t - interval '1 hour', fim_original_em = fim.t, fim_em = fim.t
         from (select date_trunc('milliseconds', clock_timestamp())
                      + make_interval(secs => $2::double precision / 1000) as t) as fim
        where lots.id = $1`,
      [id, ms],
    );
    return id;
  }

  async function loteVencidoComLance(): Promise<{ loteId: string; licitanteId: string }> {
    const [licitante] = await apoio.licitantesComSaldo(1);
    if (licitante === undefined) throw new Error('sem licitante');
    const loteId = await apoio.lote();
    const resposta = await apoio.lancar(licitante, loteId, 1000);
    expect(resposta.statusCode).toBe(201);
    await encerrarPorSql(pool, loteId, { status: 'ao_vivo' });
    sobras.push(loteId);
    return { loteId, licitanteId: licitante.id };
  }

  it(
    'encerra lotes vencidos em até 2 s, p95 medido, e publica lote_encerrado',
    async () => {
      const ids: string[] = [];
      for (let i = 0; i < AMOSTRAS_DE_ATRASO; i++) ids.push(await loteQueVenceEm(1_200 + i * 100));
      sobras.push(...ids);
      const agendador = criar(ids);
      expect(await agendador.iniciar({ registrarChave: () => Promise.resolve() })).toBe(true);

      await ate(
        async () => {
          const { rows } = await pool.query(
            `select 1 from lots where id = any($1::uuid[]) and status = 'ao_vivo'`,
            [ids],
          );
          return rows.length === 0;
        },
        { limiteMs: 30_000, descricao: 'todos os lotes encerrados' },
      );
      await agendador.parar();

      const { rows } = await pool.query<{ atraso_ms: number }>(
        `select extract(epoch from (encerrado_em - fim_em)) * 1000 as atraso_ms
           from lots where id = any($1::uuid[]) order by 1`,
        [ids],
      );
      const atrasos = rows.map((r) => Number(r.atraso_ms)).sort((a, b) => a - b);
      const p95 = atrasos[Math.ceil(atrasos.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY;
      expect(atrasos.every((a) => a >= 0)).toBe(true);
      expect(p95).toBeLessThanOrEqual(LIMITE_DO_ENCERRAMENTO_MS);
      const encerrados = eventos.filter(
        (e) => e.tipo === 'lote_encerrado' && ids.includes(e.payload.loteId),
      );
      expect(encerrados).toHaveLength(ids.length);
    },
    TIMEOUT_LONGO_MS,
  );

  it(
    'abre o lote agendado cujo início chegou e publica lote_iniciado depois do COMMIT',
    async () => {
      const { id } = await inserirLote(pool, leiloeiroId, {
        status: 'agendado',
        inicio_em: iso(Date.now() + 1_000),
        fim_em: iso(Date.now() + HORA_MS),
      });
      expect(await statusDe(id)).toBe('agendado');
      const agendador = criar([id]);
      expect(await agendador.iniciar({ registrarChave: () => Promise.resolve() })).toBe(true);
      await ate(() => eventos.some((e) => e.tipo === 'lote_iniciado' && e.payload.loteId === id), {
        limiteMs: 15_000,
        descricao: 'lote_iniciado do lote agendado',
      });
      expect(await statusDe(id)).toBe('ao_vivo');
      const emitidos = eventos.filter((e) => e.tipo === 'lote_iniciado' && e.payload.loteId === id);
      expect(emitidos).toHaveLength(1);
    },
    TIMEOUT_LONGO_MS,
  );

  it(
    'liquida o lote com vencedor pelo tick e deixa a carteira reconciliada',
    async () => {
      const { loteId } = await loteVencidoComLance();
      await criar([loteId]).executarTick();
      expect(await statusDe(loteId)).toBe('encerrado');
      const { rows } = await pool.query(`select 1 from receipts where lote_id = $1`, [loteId]);
      expect(rows).toHaveLength(1);
      await exigirCarteiraReconciliada(pool);
    },
    TIMEOUT_LONGO_MS,
  );

  it(
    'dois jobs simultâneos nunca liquidam o mesmo lote em dobro',
    async () => {
      const { loteId } = await loteVencidoComLance();
      const desde = eventos.length;
      const a = criar([loteId]);
      const b = criar([loteId]);
      await Promise.all([a.executarTick(), b.executarTick()]);
      expect(await statusDe(loteId)).toBe('encerrado');
      const recibos = await pool.query(`select 1 from receipts where lote_id = $1`, [loteId]);
      const ledger = await pool.query(
        `select tipo from ledger_entries where lote_id = $1 and tipo in ('debito_arremate', 'credito_arremate')`,
        [loteId],
      );
      expect(recibos.rows).toHaveLength(1);
      expect(ledger.rows.map((r: { tipo: string }) => r.tipo).sort()).toEqual([
        'credito_arremate',
        'debito_arremate',
      ]);
      const publicados = eventos
        .slice(desde)
        .filter((e) => e.tipo === 'lote_encerrado' && e.payload.loteId === loteId);
      expect(publicados).toHaveLength(1);
    },
    TIMEOUT_LONGO_MS,
  );

  it(
    'grava encerrado_em com o relógio do banco, não o do processo',
    async () => {
      const loteId = await loteQueVenceEm(-1_000);
      sobras.push(loteId);
      const agendador = criar([loteId]);
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(Date.now() + 365 * 24 * HORA_MS));
      try {
        await agendador.executarTick();
      } finally {
        vi.useRealTimers();
      }
      const { rows } = await pool.query<{ dentro: boolean }>(
        `select encerrado_em between fim_em and now() as dentro from lots where id = $1`,
        [loteId],
      );
      expect(await statusDe(loteId)).toBe('encerrado');
      expect(rows[0]?.dentro).toBe(true);
    },
    TIMEOUT_LONGO_MS,
  );

  it(
    'lote veneno com 20+ lotes saudáveis vencidos: os saudáveis são encerrados e o veneno só alerta uma vez',
    async () => {
      const veneno = await loteQueVenceEm(-5_000); // o mais antigo: o primeiro da varredura
      const saudaveis: string[] = [];
      for (let i = 0; i < 22; i++) saudaveis.push(await loteQueVenceEm(-4_000 + i));
      sobras.push(veneno, ...saudaveis);
      const alertas: string[] = [];
      vi.mocked(Logger.prototype.error).mockImplementation((m: unknown) => {
        alertas.push(String(m));
      });
      const agendador = criar([veneno, ...saudaveis], [veneno]);

      for (let tick = 0; tick < 6; tick++) {
        await agendador.executarTick();
        const { rows } = await pool.query(
          `select 1 from lots where id = any($1::uuid[]) and status = 'ao_vivo'`,
          [saudaveis],
        );
        if (rows.length === 0) break;
      }
      for (const id of saudaveis) expect(await statusDe(id)).toBe('encerrado');
      expect(await statusDe(veneno)).toBe('ao_vivo');
      const doVeneno = alertas.filter((m) => m.includes(veneno));
      expect(doVeneno.filter((m) => m.includes('LOTE_COM_FALHA_DE_ENCERRAMENTO'))).toHaveLength(1);
      for (const m of alertas) expect(m).not.toMatch(/insert|select|vencedor/iu);
    },
    TIMEOUT_LONGO_MS,
  );
});
