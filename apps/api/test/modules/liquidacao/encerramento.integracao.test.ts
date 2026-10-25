// Encerramento de um lote em uma transação (tarefa 105; specs/010 §Comportamento, ADR 0032 D7).
// Postgres e Redis reais: lances pelo POST da API, encerramento pelo ServicoDeEncerramento.
// Cada cenário cria o próprio leiloeiro e os próprios licitantes, e filtra os eventos pelos ids
// dele: outros arquivos de teste usam o mesmo banco e o mesmo barramento ao mesmo tempo.
import { randomBytes } from 'node:crypto';

import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { EventoDeDominio } from '../../../src/common/eventos/publicador-de-eventos.js';
import { PublicadorDeEventos } from '../../../src/common/eventos/publicador-de-eventos.js';
import { BANCO as TOKEN_DO_BANCO } from '../../../src/config/banco.module.js';
import type { Banco } from '../../../src/db/banco.js';
import { hashGenese } from '../../../src/modules/lances/integridade/hash.js';
import {
  CadeiaDeLances,
  ErroDeSelo,
  registrarChaveDeAssinatura,
} from '../../../src/modules/lances/index.js';
import {
  emitirRecibo,
  TENTATIVAS_DO_CODIGO,
} from '../../../src/modules/liquidacao/encerramento/recibos.js';
import { ErroDeLiquidacao, ServicoDeEncerramento } from '../../../src/modules/liquidacao/index.js';
import { travarLote } from '../../../src/modules/lotes/index.js';
import { encerrarPorSql, terminarEm } from '../../helpers/lances-por-sql.js';
import { inserirUsuario } from '../../helpers/lotes-por-sql.js';
import {
  type ApoioDeLances,
  type Conta,
  criarApoioDeLances,
  erro,
  INCREMENTO_CENTAVOS,
  LANCE_INICIAL_CENTAVOS,
} from '../../integracao/apoio-de-lances.js';
import { divergenciasDaCarteira } from '../../integracao/reconciliacao.js';
import {
  type AppDeIdentidade,
  BANCO,
  criarAppDeIdentidade,
  INFRA_DISPONIVEL,
} from '../identidade/ambiente.js';

// Falha forçada no crédito do leiloeiro: o resto da carteira segue o código real.
const falhas = vi.hoisted(() => ({ credito: false }));
vi.mock('../../../src/modules/carteira/index.js', async (original) => {
  const real = await original<typeof import('../../../src/modules/carteira/index.js')>();
  return {
    ...real,
    creditarArremate: (...args: Parameters<typeof real.creditarArremate>) => {
      if (falhas.credito) return Promise.reject(new Error('falha forçada no crédito'));
      return real.creditarArremate(...args);
    },
  };
});

const TIMEOUT_LONGO_MS = 60_000;
const SALDO_CENTAVOS = 100_000;
const FIM_DA_DISPUTA_MS = 1_500;
const PAUSA_ENTRE_TENTATIVAS_MS = 20;
const ANTECEDENCIA_DO_LANCE_MS = 30;

interface Cenario {
  readonly leiloeiroId: string;
  readonly apoio: ApoioDeLances;
}

interface LinhaDoSelo {
  status: string;
  total_lances: number;
  hash_final: Buffer;
  vencedor_pseudonimo: string | null;
  valor_arremate_centavos: string | null;
  selado_em: Date;
  assinatura: Buffer;
  key_id: string;
}

interface Fotografia {
  readonly lote: unknown;
  readonly ledger: unknown;
  readonly selos: unknown;
  readonly recibos: unknown;
  readonly saldos: unknown;
}

const esperar = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

describe.skipIf(!INFRA_DISPONIVEL)('ServicoDeEncerramento (Postgres e Redis reais)', () => {
  let ctx: AppDeIdentidade;
  let pool: pg.Pool;
  let servico: ServicoDeEncerramento;
  let cadeia: CadeiaDeLances;
  let banco: Banco;
  const eventos: EventoDeDominio[] = [];
  const desligar: (() => void)[] = [];
  const lotesVencidos: string[] = [];

  beforeAll(async () => {
    ctx = await criarAppDeIdentidade();
    await registrarChaveDeAssinatura(ctx.app);
    pool = new pg.Pool(BANCO.conexao());
    servico = ctx.app.get(ServicoDeEncerramento);
    cadeia = ctx.app.get(CadeiaDeLances);
    banco = ctx.app.get<Banco>(TOKEN_DO_BANCO);
    const publicador = ctx.app.get(PublicadorDeEventos);
    for (const tipo of ['lote_encerrado', 'lote_arrematado', 'saldo_atualizado'] as const) {
      desligar.push(
        publicador.aoOcorrer(tipo, (payload, destino) => {
          eventos.push({ tipo, payload, ...destino } as EventoDeDominio);
        }),
      );
    }
  }, TIMEOUT_LONGO_MS);

  afterEach(async () => {
    falhas.credito = false;
    vi.restoreAllMocks();
    // Lote vencido que o teste não encerrou (cenários de falha) ficaria no banco compartilhado
    // como "veneno" para o job e para candidatosAoEncerramento: empurra o fim para o futuro por
    // SQL, sem tocar em selos, recibos nem ledger (append-only).
    const sobras = lotesVencidos.splice(0);
    if (sobras.length === 0) return;
    await pool.query(
      `update lots
          set inicio_em = now() - interval '2 hours',
              fim_original_em = now() + interval '1 day',
              fim_em = now() + interval '1 day'
        where id = any($1::uuid[]) and status = 'ao_vivo'`,
      [sobras],
    );
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

  async function cenario(): Promise<Cenario> {
    await ctx.resetarLimite();
    const leiloeiro = await inserirUsuario(pool, 'leiloeiro');
    return { leiloeiroId: leiloeiro.id, apoio: criarApoioDeLances(ctx, pool, leiloeiro.id) };
  }

  /** Lote com os lances dados (em ordem), já vencido e ainda `ao_vivo`, à espera do job. */
  async function loteVencido(
    { apoio }: Cenario,
    lances: readonly { conta: Conta; valor: number }[],
  ): Promise<string> {
    const loteId = await apoio.lote();
    for (const { conta, valor } of lances) {
      const resposta = await apoio.lancar(conta, loteId, valor);
      expect(resposta.statusCode, JSON.stringify(erro(resposta))).toBe(201);
    }
    await encerrarPorSql(pool, loteId, { status: 'ao_vivo' });
    lotesVencidos.push(loteId);
    return loteId;
  }

  /** Eventos do lote e dos usuários a partir da posição `desde` (ignora os de lance e depósito). */
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
          : usuarios.includes(e.usuarioId) &&
            (e.tipo !== 'lote_arrematado' || e.payload.loteId === loteId),
      );
  }

  async function selo(loteId: string): Promise<LinhaDoSelo | undefined> {
    const { rows } = await pool.query<LinhaDoSelo>(
      `select status, total_lances, hash_final, vencedor_pseudonimo,
              valor_arremate_centavos::text as valor_arremate_centavos, selado_em, assinatura,
              key_id
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

  async function fotografar(loteId: string, usuarios: readonly string[]): Promise<Fotografia> {
    const um = async (sql: string, params: unknown[]): Promise<unknown> =>
      (await pool.query(sql, params)).rows;
    return {
      lote: await um(
        `select status, vencedor_id, valor_arremate_centavos::text, encerrado_em
           from lots where id = $1`,
        [loteId],
      ),
      ledger: await um(
        'select id from ledger_entries where lote_id = $1 or user_id = any($2::uuid[]) order by id',
        [loteId, usuarios],
      ),
      selos: await um('select lote_id, hash_final from lot_seals where lote_id = $1', [loteId]),
      recibos: await um('select id from receipts where lote_id = $1', [loteId]),
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

  it(
    'com vencedor: debita, credita, emite o recibo coerente com o selo e encerra o lote',
    async () => {
      const c = await cenario();
      const [ana, beto] = await c.apoio.licitantesComSaldo(2, SALDO_CENTAVOS);
      if (ana === undefined || beto === undefined) throw new Error('licitantes não criados');
      const lanceFinal = LANCE_INICIAL_CENTAVOS + INCREMENTO_CENTAVOS;
      const loteId = await loteVencido(c, [
        { conta: ana, valor: LANCE_INICIAL_CENTAVOS },
        { conta: beto, valor: lanceFinal },
      ]);
      const usuarios = [ana.id, beto.id, c.leiloeiroId];
      const desde = eventos.length;

      const resultado = await servico.encerrar(loteId);

      expect(resultado).not.toBeNull();
      expect(await saldo(beto.id)).toEqual({ total: SALDO_CENTAVOS - lanceFinal, comprometido: 0 });
      expect(await saldo(ana.id)).toEqual({ total: SALDO_CENTAVOS, comprometido: 0 });
      expect(await saldo(c.leiloeiroId)).toEqual({ total: lanceFinal, comprometido: 0 });
      await semDivergencias(usuarios);

      const { rows: ultimo } = await pool.query<{ id: string; hash: Buffer; pseudonimo: string }>(
        'select id, hash, pseudonimo from bids where lote_id = $1 order by seq desc limit 1',
        [loteId],
      );
      const gravado = await selo(loteId);
      expect(gravado).toMatchObject({
        status: 'encerrado',
        total_lances: 2,
        vencedor_pseudonimo: ultimo[0]?.pseudonimo,
        valor_arremate_centavos: String(lanceFinal),
      });
      expect(gravado?.hash_final.equals(ultimo[0]?.hash ?? Buffer.alloc(0))).toBe(true);

      // D8/nota da 102: o recibo é cópia exata do selo, do último lance e do líder.
      const { rows: recibos } = await pool.query<{
        codigo_publico: string;
        vencedor_id: string;
        vencedor_pseudonimo: string;
        valor_centavos: string;
        hash_final: Buffer;
        assinatura_selo: Buffer;
        key_id: string;
        selado_em: Date;
      }>('select *, valor_centavos::text as valor_centavos from receipts where lote_id = $1', [
        loteId,
      ]);
      expect(recibos).toHaveLength(1);
      const recibo = recibos[0];
      expect(recibo?.vencedor_id).toBe(beto.id);
      expect(recibo?.vencedor_pseudonimo).toBe(gravado?.vencedor_pseudonimo);
      expect(recibo?.valor_centavos).toBe(String(lanceFinal));
      expect(recibo?.hash_final.equals(gravado?.hash_final ?? Buffer.alloc(0))).toBe(true);
      expect(recibo?.assinatura_selo.equals(gravado?.assinatura ?? Buffer.alloc(0))).toBe(true);
      expect(recibo?.key_id).toBe(gravado?.key_id);
      expect(recibo?.selado_em.getTime()).toBe(gravado?.selado_em.getTime());
      expect(recibo?.codigo_publico).toMatch(/^[0-9A-Za-z]{16}$/);

      // Débito e crédito com o mesmo valor, ligados ao lance arrematado.
      const { rows: ledger } = await pool.query<{ tipo: string; user_id: string; valor: string }>(
        `select tipo::text as tipo, user_id, valor_centavos::text as valor from ledger_entries
          where lote_id = $1 and tipo in ('debito_arremate', 'credito_arremate')
            and lance_id = $2 order by tipo`,
        [loteId, ultimo[0]?.id],
      );
      expect(ledger).toEqual([
        { tipo: 'credito_arremate', user_id: c.leiloeiroId, valor: String(lanceFinal) },
        { tipo: 'debito_arremate', user_id: beto.id, valor: String(lanceFinal) },
      ]);

      const { rows: lote } = await pool.query<{
        status: string;
        vencedor_id: string;
        valor: string;
        encerrado_em: Date | null;
      }>(
        `select status::text as status, vencedor_id, valor_arremate_centavos::text as valor,
                encerrado_em from lots where id = $1`,
        [loteId],
      );
      expect(lote[0]).toMatchObject({ status: 'encerrado', vencedor_id: beto.id });
      expect(lote[0]?.valor).toBe(String(lanceFinal));
      expect(lote[0]?.encerrado_em).toBeInstanceOf(Date);

      // Eventos depois do COMMIT; o público sem id de usuário.
      const saidos = eventosDe(loteId, usuarios, desde);
      expect(saidos).toContainEqual({
        tipo: 'lote_encerrado',
        payload: {
          loteId,
          vencedorPseudonimo: gravado?.vencedor_pseudonimo,
          valorArremateCentavos: lanceFinal,
        },
      });
      expect(saidos).toContainEqual({
        tipo: 'lote_arrematado',
        usuarioId: beto.id,
        payload: { loteId, codigoComprovante: recibo?.codigo_publico },
      });
      expect(saidos).toContainEqual({
        tipo: 'saldo_atualizado',
        usuarioId: beto.id,
        payload: {
          totalCentavos: SALDO_CENTAVOS - lanceFinal,
          comprometidoCentavos: 0,
          disponivelCentavos: SALDO_CENTAVOS - lanceFinal,
        },
      });
      expect(saidos).toContainEqual({
        tipo: 'saldo_atualizado',
        usuarioId: c.leiloeiroId,
        payload: {
          totalCentavos: lanceFinal,
          comprometidoCentavos: 0,
          disponivelCentavos: lanceFinal,
        },
      });
      expect(saidos.filter((e) => e.usuarioId === ana.id)).toEqual([]);
      const publico = JSON.stringify(saidos.filter((e) => e.usuarioId === undefined));
      for (const id of usuarios) expect(publico).not.toContain(id);
      expect(resultado).toEqual({
        loteId,
        vencedor: {
          pseudonimo: gravado?.vencedor_pseudonimo,
          valorCentavos: lanceFinal,
          codigoComprovante: recibo?.codigo_publico,
        },
      });

      // Idempotente: lote já encerrado → null, sem efeito.
      const antes = await fotografar(loteId, usuarios);
      expect(await servico.encerrar(loteId)).toBeNull();
      expect(await fotografar(loteId, usuarios)).toEqual(antes);
    },
    TIMEOUT_LONGO_MS,
  );

  it(
    'sem lances: selo com total 0 e hash da gênese, sem lançamento nem recibo',
    async () => {
      const c = await cenario();
      const loteId = await loteVencido(c, []);
      const desde = eventos.length;

      const resultado = await servico.encerrar(loteId);

      expect(resultado).toEqual({ loteId, vencedor: null });
      const gravado = await selo(loteId);
      expect(gravado).toMatchObject({
        status: 'encerrado',
        total_lances: 0,
        vencedor_pseudonimo: null,
        valor_arremate_centavos: null,
      });
      expect(gravado?.hash_final.toString('hex')).toBe(hashGenese(loteId));
      const contagem = await pool.query<{ ledger: string; recibos: string; carteira: string }>(
        `select (select count(*) from ledger_entries where lote_id = $1)::text as ledger,
                (select count(*) from receipts where lote_id = $1)::text as recibos,
                (select count(*) from wallet_balances where user_id = $2)::text as carteira`,
        [loteId, c.leiloeiroId],
      );
      expect(contagem.rows[0]).toEqual({ ledger: '0', recibos: '0', carteira: '0' });
      const { rows } = await pool.query<{ status: string; vencedor_id: string | null }>(
        'select status::text as status, vencedor_id from lots where id = $1',
        [loteId],
      );
      expect(rows[0]).toEqual({ status: 'encerrado', vencedor_id: null });
      expect(eventosDe(loteId, [c.leiloeiroId], desde)).toEqual([
        { tipo: 'lote_encerrado', payload: { loteId } },
      ]);
    },
    TIMEOUT_LONGO_MS,
  );

  it(
    'colisão do código público: tenta outro código num savepoint; 3 colisões → erro',
    async () => {
      const c = await cenario();
      const [ana] = await c.apoio.licitantesComSaldo(1, SALDO_CENTAVOS);
      if (ana === undefined) throw new Error('licitante não criado');
      const vendido = await loteVencido(c, [{ conta: ana, valor: LANCE_INICIAL_CENTAVOS }]);
      const codigoExistente = (await servico.encerrar(vendido))?.vencedor?.codigoComprovante;
      if (codigoExistente === undefined) throw new Error('recibo não emitido');
      const outroLote = await c.apoio.lote();
      const { rows } = await pool.query<{ key_id: string }>(
        'select key_id from signing_keys limit 1',
      );
      const dados = {
        loteId: outroLote,
        vencedorId: ana.id,
        vencedorPseudonimo: 'Licitante #abcdef',
        valorCentavos: LANCE_INICIAL_CENTAVOS,
        hashFinalHex: randomBytes(32).toString('hex'),
        assinaturaSeloBase64url: randomBytes(64).toString('base64url'),
        keyId: rows[0]?.key_id ?? '',
        seladoEm: new Date().toISOString(),
      };
      const novo = 'Novo0000Codigo00';
      const DESFAZER = new Error('desfaz a transação do teste');

      const emitido = banco.transaction(async (tx) => {
        const sorteios = [codigoExistente, codigoExistente, novo];
        const codigo = await emitirRecibo(tx, dados, () => sorteios.shift() ?? '');
        // A transação segue utilizável depois das colisões (savepoint por tentativa).
        const { rows: gravado } = await tx.execute<{ codigo_publico: string }>(
          sql`select codigo_publico from receipts where lote_id = ${outroLote}`,
        );
        expect({ codigo, gravado: gravado[0]?.codigo_publico }).toEqual({
          codigo: novo,
          gravado: novo,
        });
        throw DESFAZER;
      });
      await expect(emitido).rejects.toBe(DESFAZER);

      const esgotado = banco.transaction((tx) => emitirRecibo(tx, dados, () => codigoExistente));
      await expect(esgotado).rejects.toThrow(
        new ErroDeLiquidacao('CODIGO_PUBLICO_ESGOTADO', outroLote),
      );
      expect(TENTATIVAS_DO_CODIGO).toBe(3);
      const { rows: recibos } = await pool.query('select 1 from receipts where lote_id = $1', [
        outroLote,
      ]);
      expect(recibos).toEqual([]);
    },
    TIMEOUT_LONGO_MS,
  );

  it(
    'lote travado por outra transação ou ainda não vencido → null, sem efeito',
    async () => {
      const c = await cenario();
      const naoVencido = await c.apoio.lote();
      expect(await servico.encerrar(naoVencido)).toBeNull();

      const loteId = await loteVencido(c, []);
      const outra = await pool.connect();
      try {
        await outra.query('begin');
        await outra.query('select id from lots where id = $1 for update', [loteId]);
        expect(await servico.encerrar(loteId)).toBeNull();
        expect(await selo(loteId)).toBeUndefined();
      } finally {
        await outra.query('rollback');
        outra.release();
      }
      expect(await servico.encerrar(loteId)).toEqual({ loteId, vencedor: null });
    },
    TIMEOUT_LONGO_MS,
  );

  describe('falha forçada: nada muda e nenhum evento sai', () => {
    async function loteDisputado(): Promise<{ loteId: string; usuarios: string[]; c: Cenario }> {
      const c = await cenario();
      const [ana, beto] = await c.apoio.licitantesComSaldo(2, SALDO_CENTAVOS);
      if (ana === undefined || beto === undefined) throw new Error('licitantes não criados');
      const loteId = await loteVencido(c, [
        { conta: ana, valor: LANCE_INICIAL_CENTAVOS },
        { conta: beto, valor: LANCE_INICIAL_CENTAVOS + INCREMENTO_CENTAVOS },
      ]);
      return { loteId, usuarios: [ana.id, beto.id, c.leiloeiroId], c };
    }

    async function exigirSemEfeito(
      loteId: string,
      usuarios: readonly string[],
      acao: () => Promise<unknown>,
      esperado: unknown,
    ): Promise<void> {
      const antes = await fotografar(loteId, usuarios);
      const desde = eventos.length;
      await expect(acao()).rejects.toThrow(esperado as Error);
      expect(await fotografar(loteId, usuarios)).toEqual(antes);
      expect(eventosDe(loteId, usuarios, desde)).toEqual([]);
      await semDivergencias(usuarios);
    }

    it(
      'em selar (selo já gravado vira erro de domínio)',
      async () => {
        const { loteId, usuarios } = await loteDisputado();
        // Outro selo gravado e confirmado antes: o unique de lot_seals recusa o do encerramento.
        await banco.transaction(async (tx) => {
          const lote = await travarLote(tx, loteId);
          if (lote === null) throw new Error('lote sumiu');
          await cadeia.selar(tx, { loteId, status: 'encerrado', seladoEm: new Date(), lote });
        });

        await exigirSemEfeito(loteId, usuarios, () => servico.encerrar(loteId), ErroDeSelo);
      },
      TIMEOUT_LONGO_MS,
    );

    it(
      'em creditarArremate',
      async () => {
        const { loteId, usuarios } = await loteDisputado();
        falhas.credito = true;

        await exigirSemEfeito(
          loteId,
          usuarios,
          () => servico.encerrar(loteId),
          /falha forçada no crédito/,
        );
        falhas.credito = false;
        expect(await servico.encerrar(loteId)).not.toBeNull();
      },
      TIMEOUT_LONGO_MS,
    );

    it(
      'no recibo (recibo já emitido para o lote vira erro de domínio)',
      async () => {
        const { loteId, usuarios } = await loteDisputado();
        const { rows: chave } = await pool.query<{ key_id: string }>(
          'select key_id from signing_keys limit 1',
        );
        await pool.query(
          `insert into receipts (lote_id, codigo_publico, vencedor_id, vencedor_pseudonimo,
                                 valor_centavos, hash_final, assinatura_selo, key_id, selado_em)
           values ($1, $2, $3, 'Licitante #abcdef', 1000, $4, $5, $6, now())`,
          [
            loteId,
            randomBytes(8).toString('hex'),
            usuarios[1],
            randomBytes(32),
            randomBytes(64),
            chave[0]?.key_id,
          ],
        );

        await exigirSemEfeito(
          loteId,
          usuarios,
          () => servico.encerrar(loteId),
          new ErroDeLiquidacao('RECIBO_JA_EMITIDO', loteId),
        );
      },
      TIMEOUT_LONGO_MS,
    );

    it(
      'selo incoerente com o lote travado: erro de integridade, log só com o loteId',
      async () => {
        const { loteId, usuarios } = await loteDisputado();
        const selarReal = cadeia.selar.bind(cadeia);
        vi.spyOn(cadeia, 'selar').mockImplementation(async (tx, novo) => ({
          ...(await selarReal(tx, novo)),
          vencedorPseudonimo: 'Licitante #000000',
        }));
        const linhasAntes = ctx.linhas.length;

        await exigirSemEfeito(
          loteId,
          usuarios,
          () => servico.encerrar(loteId),
          new ErroDeLiquidacao('SELO_INCOERENTE', loteId),
        );
        const logs = JSON.stringify(ctx.linhas.slice(linhasAntes));
        expect(logs).toContain(loteId);
        expect(logs).toContain('SELO_INCOERENTE');
        for (const id of usuarios) expect(logs).not.toContain(id);
      },
      TIMEOUT_LONGO_MS,
    );
  });

  it(
    'lance concorrente: entra antes e o selo o cobre, ou é recusado LOTE_ENCERRADO',
    async () => {
      const c = await cenario();
      const [ana, beto] = await c.apoio.licitantesComSaldo(2, SALDO_CENTAVOS);
      if (ana === undefined || beto === undefined) throw new Error('licitantes não criados');
      const loteId = await c.apoio.lote();
      expect((await c.apoio.lancar(ana, loteId, LANCE_INICIAL_CENTAVOS)).statusCode).toBe(201);
      // O lance da Ana estendeu o fim (anti-sniping); volta a vencer daqui a pouco.
      await terminarEm(pool, loteId, FIM_DA_DISPUTA_MS);

      // O job tenta encerrar sem parar enquanto o Beto lança perto do fim: corrida real pelo
      // FOR UPDATE do lote. Se o lance do Beto entra, o anti-sniping estende o fim de novo, e o
      // teste o vence por SQL para o job poder seguir.
      const encerramento = (async () => {
        for (;;) {
          const resultado = await servico.encerrar(loteId);
          if (resultado !== null) return resultado;
          await esperar(PAUSA_ENTRE_TENTATIVAS_MS);
        }
      })();
      await esperar(FIM_DA_DISPUTA_MS - ANTECEDENCIA_DO_LANCE_MS);
      const doBeto = await c.apoio.lancar(
        beto,
        loteId,
        LANCE_INICIAL_CENTAVOS + INCREMENTO_CENTAVOS,
      );
      if (doBeto.statusCode === 201) await terminarEm(pool, loteId, -1_000);
      const resultado = await encerramento;
      // Um lance depois do encerramento é recusado pelo status gravado.
      const tardio = await c.apoio.lancar(ana, loteId, 10 * LANCE_INICIAL_CENTAVOS);

      expect([201, 422]).toContain(doBeto.statusCode);
      if (doBeto.statusCode === 422) expect(erro(doBeto).codigo).toBe('LOTE_ENCERRADO');
      expect(tardio.statusCode).toBe(422);
      expect(erro(tardio).codigo).toBe('LOTE_ENCERRADO');
      const contas = [ana, beto];
      const lances = await c.apoio.lancesDoLote(loteId);
      expect(lances).toHaveLength(doBeto.statusCode === 201 ? 2 : 1);
      const gravado = await selo(loteId);
      expect(gravado?.total_lances).toBe(lances.length);
      const ultimo = lances.at(-1);
      expect(gravado?.valor_arremate_centavos ?? null).toBe(
        ultimo === undefined ? null : String(ultimo.valorCentavos),
      );
      expect(resultado.vencedor?.valorCentavos ?? null).toBe(ultimo?.valorCentavos ?? null);
      await semDivergencias([...contas.map((x) => x.id), c.leiloeiroId]);
    },
    TIMEOUT_LONGO_MS,
  );
});
