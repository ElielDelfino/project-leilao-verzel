// Cancelamento de lote com estorno (tarefa 106; specs/010 §Cancelamento, ADR 0025 e 0032).
// Postgres e Redis reais: lances pelo POST da API, cancelamento pelo POST do painel. Cada cenário
// cria o próprio leiloeiro e os próprios licitantes, e filtra os eventos pelos ids dele: outros
// arquivos de teste usam o mesmo banco e o mesmo barramento ao mesmo tempo.
import { randomUUID } from 'node:crypto';

import type { LightMyRequestResponse } from 'fastify';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { FALHA_INTERNA } from '../../../../src/common/erros/traducao.js';
import type { EventoDeDominio } from '../../../../src/common/eventos/publicador-de-eventos.js';
import { PublicadorDeEventos } from '../../../../src/common/eventos/publicador-de-eventos.js';
import { emitirAccessToken } from '../../../../src/modules/identidade/tokens.js';
import { hashGenese } from '../../../../src/modules/lances/integridade/hash.js';
import {
  CadeiaDeLances,
  registrarChaveDeAssinatura,
} from '../../../../src/modules/lances/index.js';
import { encerrarPorSql, terminarEm } from '../../../helpers/lances-por-sql.js';
import { inserirUsuario, iso } from '../../../helpers/lotes-por-sql.js';
import {
  type ApoioDeLances,
  CSRF,
  criarApoioDeLances,
  erro,
  INCREMENTO_CENTAVOS,
  LANCE_INICIAL_CENTAVOS,
} from '../../../integracao/apoio-de-lances.js';
import { divergenciasDaCarteira } from '../../../integracao/reconciliacao.js';
import {
  type AppDeIdentidade,
  BANCO,
  CHAVE_JWT,
  criarAppDeIdentidade,
  INFRA_DISPONIVEL,
} from '../../identidade/ambiente.js';

/** O que a transação já gravou quando `cancelarLote` (a última escrita) é chamado. */
interface NoMeioDaTransacao {
  readonly selos: number;
  readonly estornos: number;
  readonly comprometido_do_lider: string | null;
  [coluna: string]: unknown;
}

/**
 * Falha forçada em `cancelarLote`, DEPOIS do selo e do estorno: `erro` lança um Error qualquer;
 * `fimVence` faz o fim vencer na própria `tx` (entre o `agora(tx)` e o UPDATE) e deixa o
 * `cancelarLote` real recusar com FIM_VENCIDO.
 */
type FalhaDepoisDoEstorno = 'erro' | 'fimVence';

// Falha forçada no estorno do líder: o resto da carteira segue o código real.
const falhas = vi.hoisted(() => ({
  estorno: false,
  depoisDoEstorno: null as FalhaDepoisDoEstorno | null,
  observado: undefined as NoMeioDaTransacao | undefined,
}));
vi.mock('../../../../src/modules/lotes/index.js', async (original) => {
  const real = await original<typeof import('../../../../src/modules/lotes/index.js')>();
  const { sql } = await import('drizzle-orm');
  return {
    ...real,
    cancelarLote: async (...args: Parameters<typeof real.cancelarLote>) => {
      const [tx, loteId] = args;
      if (falhas.depoisDoEstorno !== null) {
        // Prova que a falha é depois das escritas: o selo e o estorno já estão na `tx`.
        const { rows } = await tx.execute<NoMeioDaTransacao>(
          sql`select (select count(*) from lot_seals where lote_id = ${loteId})::int as selos,
                     (select count(*) from ledger_entries
                       where lote_id = ${loteId} and tipo = 'estorno')::int as estornos,
                     (select w.comprometido_centavos::text from wallet_balances w
                        join lots l on l.lider_id = w.user_id
                       where l.id = ${loteId}) as comprometido_do_lider`,
        );
        falhas.observado = rows[0];
        if (falhas.depoisDoEstorno === 'erro') throw new Error('falha forçada depois do estorno');
        // Como `terminarEm`, mas na `tx`: o fim passa 1 s antes do relógio do banco.
        await tx.execute(
          sql`update lots
                 set inicio_em = fim.t - interval '1 hour', fim_original_em = fim.t, fim_em = fim.t
                from (select date_trunc('milliseconds', clock_timestamp())
                             - interval '1 second' as t) as fim
               where lots.id = ${loteId}`,
        );
      }
      return real.cancelarLote(...args);
    },
  };
});
vi.mock('../../../../src/modules/carteira/index.js', async (original) => {
  const real = await original<typeof import('../../../../src/modules/carteira/index.js')>();
  return {
    ...real,
    estornar: (...args: Parameters<typeof real.estornar>) => {
      if (falhas.estorno) return Promise.reject(new Error('falha forçada no estorno'));
      return real.estornar(...args);
    },
  };
});

const TIMEOUT_LONGO_MS = 60_000;
const SALDO_CENTAVOS = 100_000;
const HORA_MS = 60 * 60 * 1000;
/** O lock_timeout é de 5 s (specs/010); a resposta 503 tem de sair antes do statement_timeout. */
const LIMITE_DA_ESPERA_MS = 9_000;

interface Cenario {
  readonly leiloeiroId: string;
  readonly cabecalhos: Readonly<Record<string, string>>;
  readonly apoio: ApoioDeLances;
}

interface LinhaDoSelo {
  status: string;
  total_lances: number;
  hash_final: Buffer;
  vencedor_pseudonimo: string | null;
  valor_arremate_centavos: string | null;
}

interface Fotografia {
  readonly lote: unknown;
  readonly ledger: unknown;
  readonly selos: unknown;
  readonly saldos: unknown;
}

describe.skipIf(!INFRA_DISPONIVEL)('cancelamento de lote (Postgres e Redis reais)', () => {
  let ctx: AppDeIdentidade;
  let pool: pg.Pool;
  let cadeia: CadeiaDeLances;
  const eventos: EventoDeDominio[] = [];
  const desligar: (() => void)[] = [];

  beforeAll(async () => {
    ctx = await criarAppDeIdentidade();
    await registrarChaveDeAssinatura(ctx.app);
    pool = new pg.Pool(BANCO.conexao());
    cadeia = ctx.app.get(CadeiaDeLances);
    const publicador = ctx.app.get(PublicadorDeEventos);
    for (const tipo of ['lote_cancelado', 'saldo_atualizado'] as const) {
      desligar.push(
        publicador.aoOcorrer(tipo, (payload, destino) => {
          eventos.push({ tipo, payload, ...destino } as EventoDeDominio);
        }),
      );
    }
  }, TIMEOUT_LONGO_MS);

  afterEach(() => {
    falhas.estorno = false;
    falhas.depoisDoEstorno = null;
    falhas.observado = undefined;
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    desligar.forEach((f) => {
      f();
    });
    const poolAberto = pool as pg.Pool | undefined;
    const appAberto = ctx as AppDeIdentidade | undefined;
    try {
      await poolAberto?.end();
    } finally {
      await appAberto?.fechar();
    }
  });

  async function cabecalhosDe(
    id: string,
    papel: 'leiloeiro' | 'licitante',
  ): Promise<Record<string, string>> {
    const token = await emitirAccessToken(CHAVE_JWT, { id, papel });
    return { cookie: `access_token=${token}; csrf_token=${CSRF}`, 'x-csrf-token': CSRF };
  }

  async function cenario(): Promise<Cenario> {
    await ctx.resetarLimite();
    const leiloeiro = await inserirUsuario(pool, 'leiloeiro');
    return {
      leiloeiroId: leiloeiro.id,
      cabecalhos: await cabecalhosDe(leiloeiro.id, 'leiloeiro'),
      apoio: criarApoioDeLances(ctx, pool, leiloeiro.id),
    };
  }

  function cancelar(
    cabecalhos: Readonly<Record<string, string>>,
    loteId: string,
    corpo?: object,
  ): Promise<LightMyRequestResponse> {
    return ctx.app.inject({
      method: 'POST',
      url: `/api/painel/lotes/${loteId}/cancelamento`,
      headers: { ...cabecalhos },
      ...(corpo === undefined ? {} : { payload: corpo }),
    });
  }

  /** Eventos do lote e dos usuários a partir da posição `desde`. */
  function eventosDe(
    loteId: string,
    usuarios: readonly string[],
    desde: number,
  ): EventoDeDominio[] {
    return eventos
      .slice(desde)
      .filter((e) =>
        e.usuarioId === undefined
          ? 'loteId' in e.payload && e.payload.loteId === loteId
          : usuarios.includes(e.usuarioId),
      );
  }

  async function selo(loteId: string): Promise<LinhaDoSelo | undefined> {
    const { rows } = await pool.query<LinhaDoSelo>(
      `select status::text as status, total_lances, hash_final, vencedor_pseudonimo,
              valor_arremate_centavos::text as valor_arremate_centavos
         from lot_seals where lote_id = $1`,
      [loteId],
    );
    return rows[0];
  }

  async function saldo(userId: string): Promise<{ total: number; comprometido: number }> {
    const { rows } = await pool.query<{ total: string; comprometido: string }>(
      `select total_centavos::text as total, comprometido_centavos::text as comprometido
         from wallet_balances where user_id = $1`,
      [userId],
    );
    return { total: Number(rows[0]?.total ?? 0), comprometido: Number(rows[0]?.comprometido ?? 0) };
  }

  async function statusGravado(
    loteId: string,
  ): Promise<{ status: string; cancelado_em: Date | null }> {
    const { rows } = await pool.query<{ status: string; cancelado_em: Date | null }>(
      'select status::text as status, cancelado_em from lots where id = $1',
      [loteId],
    );
    const linha = rows[0];
    if (linha === undefined) throw new Error('lote sumiu');
    return linha;
  }

  async function fotografar(loteId: string, usuarios: readonly string[]): Promise<Fotografia> {
    const um = async (consulta: string, params: unknown[]): Promise<unknown> =>
      (await pool.query(consulta, params)).rows;
    return {
      lote: await um(
        `select status, cancelado_em, lider_id, lance_atual_centavos::text, total_lances,
                inicio_em, fim_em, fim_original_em
           from lots where id = $1`,
        [loteId],
      ),
      ledger: await um(
        'select id from ledger_entries where lote_id = $1 or user_id = any($2::uuid[]) order by id',
        [loteId, usuarios],
      ),
      selos: await um('select lote_id from lot_seals where lote_id = $1', [loteId]),
      saldos: await um(
        `select user_id, total_centavos::text, comprometido_centavos::text
           from wallet_balances where user_id = any($1::uuid[]) order by user_id`,
        [usuarios],
      ),
    };
  }

  async function semDivergencias(usuarios: readonly string[]): Promise<void> {
    const divergentes = (await divergenciasDaCarteira(pool)).filter((d) =>
      usuarios.includes(d.userId),
    );
    expect(divergentes).toEqual([]);
  }

  /** Lote ao vivo com dois lances: Ana superada pelo Beto, que lidera com `lanceFinal`. */
  async function loteDisputado(c: Cenario): Promise<{
    loteId: string;
    anaId: string;
    betoId: string;
    lanceFinal: number;
  }> {
    const [ana, beto] = await c.apoio.licitantesComSaldo(2, SALDO_CENTAVOS);
    if (ana === undefined || beto === undefined) throw new Error('licitantes não criados');
    const loteId = await c.apoio.lote();
    const lanceFinal = LANCE_INICIAL_CENTAVOS + INCREMENTO_CENTAVOS;
    for (const [conta, valor] of [
      [ana, LANCE_INICIAL_CENTAVOS],
      [beto, lanceFinal],
    ] as const) {
      const resposta = await c.apoio.lancar(conta, loteId, valor);
      expect(resposta.statusCode, JSON.stringify(erro(resposta))).toBe(201);
    }
    return { loteId, anaId: ana.id, betoId: beto.id, lanceFinal };
  }

  it(
    'com líder: estorna o compromisso, sela `cancelado`, muda o status e publica depois do COMMIT',
    async () => {
      const c = await cenario();
      const { loteId, anaId, betoId, lanceFinal } = await loteDisputado(c);
      const usuarios = [anaId, betoId, c.leiloeiroId];
      expect(await saldo(betoId)).toEqual({ total: SALDO_CENTAVOS, comprometido: lanceFinal });
      const desde = eventos.length;

      // O corpo é ignorado: o valor estornado é o compromisso lido sob o lock do lote.
      const resposta = await cancelar(c.cabecalhos, loteId, { valorCentavos: 1 });

      expect(resposta.statusCode, resposta.body).toBe(200);
      const corpo = resposta.json() as { sucesso: boolean; dados: Record<string, unknown> };
      expect(corpo.sucesso).toBe(true);
      expect(corpo.dados).toMatchObject({
        id: loteId,
        status: 'cancelado',
        lanceAtualCentavos: lanceFinal,
        totalLances: 2,
        valorArremateCentavos: null,
      });
      for (const id of usuarios) expect(resposta.body).not.toContain(id);

      // O líder recupera o comprometido; ninguém perde total; o leiloeiro não recebe nada.
      expect(await saldo(betoId)).toEqual({ total: SALDO_CENTAVOS, comprometido: 0 });
      expect(await saldo(anaId)).toEqual({ total: SALDO_CENTAVOS, comprometido: 0 });
      expect(await saldo(c.leiloeiroId)).toEqual({ total: 0, comprometido: 0 });
      await semDivergencias(usuarios);

      // Estorno com lote_id e lance_id do lance do líder (ADR 0032 D4), no valor do compromisso.
      const { rows: ultimo } = await pool.query<{ id: string; hash: Buffer }>(
        'select id, hash from bids where lote_id = $1 order by seq desc limit 1',
        [loteId],
      );
      const { rows: estornos } = await pool.query<{
        user_id: string;
        valor: string;
        lance_id: string;
      }>(
        `select user_id, valor_centavos::text as valor, lance_id from ledger_entries
          where lote_id = $1 and tipo = 'estorno'`,
        [loteId],
      );
      expect(estornos).toEqual([
        { user_id: betoId, valor: String(lanceFinal), lance_id: ultimo[0]?.id },
      ]);

      const gravado = await selo(loteId);
      expect(gravado).toMatchObject({
        status: 'cancelado',
        total_lances: 2,
        vencedor_pseudonimo: null,
        valor_arremate_centavos: null,
      });
      expect(gravado?.hash_final.equals(ultimo[0]?.hash ?? Buffer.alloc(0))).toBe(true);
      const gravadoNoLote = await statusGravado(loteId);
      expect(gravadoNoLote.status).toBe('cancelado');
      expect(gravadoNoLote.cancelado_em).toBeInstanceOf(Date);
      const { rows: recibos } = await pool.query('select 1 from receipts where lote_id = $1', [
        loteId,
      ]);
      expect(recibos).toEqual([]);

      const saidos = eventosDe(loteId, usuarios, desde);
      expect(saidos).toEqual([
        { tipo: 'lote_cancelado', payload: { loteId } },
        {
          tipo: 'saldo_atualizado',
          usuarioId: betoId,
          payload: {
            totalCentavos: SALDO_CENTAVOS,
            comprometidoCentavos: 0,
            disponivelCentavos: SALDO_CENTAVOS,
          },
        },
      ]);

      // Repetir depois do sucesso → 409, sem efeito.
      const antes = await fotografar(loteId, usuarios);
      const repetido = await cancelar(c.cabecalhos, loteId);
      expect(repetido.statusCode).toBe(409);
      expect(erro(repetido).codigo).toBe('LOTE_ENCERRADO');
      expect(await fotografar(loteId, usuarios)).toEqual(antes);
    },
    TIMEOUT_LONGO_MS,
  );

  it(
    'lote sem lances: selo com total 0 (gênese), sem estorno nem saldo_atualizado',
    async () => {
      const c = await cenario();
      const loteId = await c.apoio.lote();
      const desde = eventos.length;

      const resposta = await cancelar(c.cabecalhos, loteId);

      expect(resposta.statusCode, resposta.body).toBe(200);
      expect((resposta.json() as { dados: { status: string } }).dados.status).toBe('cancelado');
      const gravado = await selo(loteId);
      expect(gravado).toMatchObject({ status: 'cancelado', total_lances: 0 });
      expect(gravado?.hash_final.toString('hex')).toBe(hashGenese(loteId));
      const { rows } = await pool.query('select 1 from ledger_entries where lote_id = $1', [
        loteId,
      ]);
      expect(rows).toEqual([]);
      expect((await statusGravado(loteId)).status).toBe('cancelado');
      expect(eventosDe(loteId, [c.leiloeiroId], desde)).toEqual([
        { tipo: 'lote_cancelado', payload: { loteId } },
      ]);
    },
    TIMEOUT_LONGO_MS,
  );

  it(
    'lote agendado: cancela com selo total 0',
    async () => {
      const c = await cenario();
      const agora = Date.now();
      const loteId = await c.apoio.lote({
        status: 'agendado',
        inicio_em: iso(agora + HORA_MS),
        fim_em: iso(agora + 2 * HORA_MS),
        fim_original_em: iso(agora + 2 * HORA_MS),
      });

      const resposta = await cancelar(c.cabecalhos, loteId);

      expect(resposta.statusCode, resposta.body).toBe(200);
      expect((resposta.json() as { dados: { status: string } }).dados.status).toBe('cancelado');
      expect(await selo(loteId)).toMatchObject({ status: 'cancelado', total_lances: 0 });
      expect((await statusGravado(loteId)).status).toBe('cancelado');
    },
    TIMEOUT_LONGO_MS,
  );

  describe('recusas, sem efeito', () => {
    async function exigirRecusa(
      cabecalhos: Readonly<Record<string, string>>,
      loteId: string,
      status: number,
      codigo: string,
    ): Promise<void> {
      const usuarios: string[] = [];
      const antes = await fotografar(loteId, usuarios);
      const desde = eventos.length;
      const resposta = await cancelar(cabecalhos, loteId);
      expect(resposta.statusCode, resposta.body).toBe(status);
      expect(erro(resposta).codigo).toBe(codigo);
      expect(erro(resposta).detalhes).toBeUndefined();
      expect(await fotografar(loteId, usuarios)).toEqual(antes);
      expect(eventosDe(loteId, usuarios, desde)).toEqual([]);
    }

    it(
      'lote de outro leiloeiro → 404, indistinguível do inexistente',
      async () => {
        const dono = await cenario();
        const outro = await cenario();
        const loteId = await dono.apoio.lote();

        await exigirRecusa(outro.cabecalhos, loteId, 404, 'NAO_ENCONTRADO');
        await exigirRecusa(outro.cabecalhos, randomUUID(), 404, 'NAO_ENCONTRADO');
        expect(await selo(loteId)).toBeUndefined();
      },
      TIMEOUT_LONGO_MS,
    );

    it(
      'id que não é UUID → 404',
      async () => {
        const c = await cenario();
        const resposta = await cancelar(c.cabecalhos, 'nao-e-uuid');
        expect(resposta.statusCode).toBe(404);
        expect(erro(resposta).codigo).toBe('NAO_ENCONTRADO');
      },
      TIMEOUT_LONGO_MS,
    );

    it.each(['encerrado', 'cancelado'] as const)(
      'status gravado %s → 409 LOTE_ENCERRADO',
      async (status) => {
        const c = await cenario();
        const loteId = await c.apoio.lote();
        await encerrarPorSql(pool, loteId, { status });

        await exigirRecusa(c.cabecalhos, loteId, 409, 'LOTE_ENCERRADO');
        expect(await selo(loteId)).toBeUndefined();
      },
      TIMEOUT_LONGO_MS,
    );

    it(
      'fim_em vencido com status ainda ao_vivo (o job não rodou) → 409 LOTE_ENCERRADO',
      async () => {
        const c = await cenario();
        const loteId = await c.apoio.lote();
        await terminarEm(pool, loteId, -1_000);
        try {
          await exigirRecusa(c.cabecalhos, loteId, 409, 'LOTE_ENCERRADO');
          expect(await selo(loteId)).toBeUndefined();
        } finally {
          // Devolve o fim ao futuro mesmo se falhar: o lote não pode ficar vencido para o job.
          await terminarEm(pool, loteId, HORA_MS);
        }
      },
      TIMEOUT_LONGO_MS,
    );
  });

  describe('falha forçada: nada muda e nenhum evento sai', () => {
    /** Erro inesperado: o filtro global responde 500 INDISPONIVEL com a mensagem fixa. */
    const FALHA_INTERNA_ESPERADA = {
      status: FALHA_INTERNA.status,
      corpo: { sucesso: false, erro: FALHA_INTERNA.corpo },
    };

    async function exigirSemEfeito(
      loteId: string,
      usuarios: readonly string[],
      cabecalhos: Readonly<Record<string, string>>,
      esperado: { readonly status: number; readonly corpo: unknown } = FALHA_INTERNA_ESPERADA,
    ): Promise<void> {
      const antes = await fotografar(loteId, usuarios);
      const desde = eventos.length;
      const resposta = await cancelar(cabecalhos, loteId);
      expect(resposta.statusCode, resposta.body).toBe(esperado.status);
      expect(resposta.json()).toEqual(esperado.corpo);
      expect(await fotografar(loteId, usuarios)).toEqual(antes);
      expect(eventosDe(loteId, usuarios, desde)).toEqual([]);
      await semDivergencias(usuarios);
    }

    it(
      'no estorno: o selo, já gravado na transação, é desfeito',
      async () => {
        const c = await cenario();
        const { loteId, anaId, betoId } = await loteDisputado(c);
        falhas.estorno = true;

        await exigirSemEfeito(loteId, [anaId, betoId, c.leiloeiroId], c.cabecalhos);
        expect(await selo(loteId)).toBeUndefined();
        falhas.estorno = false;
        expect((await cancelar(c.cabecalhos, loteId)).statusCode).toBe(200);
      },
      TIMEOUT_LONGO_MS,
    );

    it.each([
      ['erro interno', 'erro', FALHA_INTERNA_ESPERADA],
      [
        'fim vencendo entre o agora(tx) e o UPDATE',
        'fimVence',
        {
          status: 409,
          corpo: {
            sucesso: false,
            erro: { codigo: 'LOTE_ENCERRADO', mensagem: 'O lote já foi encerrado.' },
          },
        },
      ],
    ] as const)(
      'em cancelarLote, depois do selo e do estorno (%s): selo, carteira e ledger voltam',
      async (_nome, falha, esperado) => {
        const c = await cenario();
        const { loteId, anaId, betoId, lanceFinal } = await loteDisputado(c);
        const usuarios = [anaId, betoId, c.leiloeiroId];
        const ledgerAntes = await pool.query('select 1 from ledger_entries where lote_id = $1', [
          loteId,
        ]);
        falhas.depoisDoEstorno = falha;

        await exigirSemEfeito(loteId, usuarios, c.cabecalhos, esperado);

        // A falha veio depois das escritas: o selo e o estorno existiam na transação desfeita.
        expect(falhas.observado).toEqual({ selos: 1, estornos: 1, comprometido_do_lider: '0' });
        expect(await selo(loteId)).toBeUndefined();
        expect(await saldo(betoId)).toEqual({ total: SALDO_CENTAVOS, comprometido: lanceFinal });
        const ledgerDepois = await pool.query('select 1 from ledger_entries where lote_id = $1', [
          loteId,
        ]);
        expect(ledgerDepois.rowCount).toBe(ledgerAntes.rowCount);
        expect((await statusGravado(loteId)).status).toBe('ao_vivo');

        falhas.depoisDoEstorno = null;
        expect((await cancelar(c.cabecalhos, loteId)).statusCode).toBe(200);
        expect(await saldo(betoId)).toEqual({ total: SALDO_CENTAVOS, comprometido: 0 });
      },
      TIMEOUT_LONGO_MS,
    );

    it(
      'no selo (primeira escrita, antes de qualquer gravação)',
      async () => {
        const c = await cenario();
        const { loteId, anaId, betoId } = await loteDisputado(c);
        vi.spyOn(cadeia, 'selar').mockRejectedValue(new Error('falha forçada no selo'));

        await exigirSemEfeito(loteId, [anaId, betoId, c.leiloeiroId], c.cabecalhos);
        vi.restoreAllMocks();
        expect((await cancelar(c.cabecalhos, loteId)).statusCode).toBe(200);
      },
      TIMEOUT_LONGO_MS,
    );
  });

  it(
    'contenção: lote travado por outra transação além de 5 s → 503 INDISPONIVEL sem detalhes',
    async () => {
      const c = await cenario();
      const { loteId, anaId, betoId } = await loteDisputado(c);
      const usuarios = [anaId, betoId, c.leiloeiroId];
      const antes = await fotografar(loteId, usuarios);
      const desde = eventos.length;
      const outra = await pool.connect();
      try {
        await outra.query('begin');
        await outra.query('select id from lots where id = $1 for update', [loteId]);
        // O lock só sai no rollback abaixo: o cancelamento desiste no lock_timeout de 5 s.
        const inicio = Date.now();
        const resposta = await cancelar(c.cabecalhos, loteId);
        expect(resposta.statusCode, resposta.body).toBe(503);
        expect(resposta.json()).toEqual({
          sucesso: false,
          erro: { codigo: 'INDISPONIVEL', mensagem: expect.any(String) as unknown },
        });
        expect(Date.now() - inicio).toBeLessThan(LIMITE_DA_ESPERA_MS);
      } finally {
        await outra.query('rollback');
        outra.release();
      }
      expect(await fotografar(loteId, usuarios)).toEqual(antes);
      expect(eventosDe(loteId, usuarios, desde)).toEqual([]);
      // Depois da contenção, o cancelamento passa e estorna o compromisso do líder.
      expect((await cancelar(c.cabecalhos, loteId)).statusCode).toBe(200);
      expect(await saldo(betoId)).toEqual({ total: SALDO_CENTAVOS, comprometido: 0 });
    },
    TIMEOUT_LONGO_MS,
  );
});
