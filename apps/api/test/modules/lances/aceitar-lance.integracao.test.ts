// Integração (Postgres e Redis reais): POST /api/lotes/{id}/lances (tarefa 079; specs/007
// §Comportamento, ADR 0031 D5, D6, D10, D11, D12). Toda resposta é validada contra o openapi pelo
// app de teste. As funções da carteira são espiadas (com a implementação real) para provar a
// ordem dos locks. Os testes pesados de concorrência e reconciliação ficam com a qa (087, 088).
import { randomUUID } from 'node:crypto';

import type { EventosDoServidor } from '@leilao/contracts';
import type { LightMyRequestResponse } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { PublicadorDeEventos } from '../../../src/common/eventos/publicador-de-eventos.js';
import type * as Carteira from '../../../src/modules/carteira/index.js';
import { comprometer, liberar, travarCarteiras } from '../../../src/modules/carteira/index.js';
import { emitirAccessToken } from '../../../src/modules/identidade/tokens.js';
import { registrarChaveDeAssinatura } from '../../../src/modules/lances/index.js';
import { inserirLote, inserirUsuario, iso } from '../../helpers/lotes-por-sql.js';
import {
  type AppDeIdentidade,
  BANCO,
  CHAVE_JWT,
  criarAppDeIdentidade,
  INFRA_DISPONIVEL,
} from '../identidade/ambiente.js';

vi.mock('../../../src/modules/carteira/index.js', async (importOriginal) => {
  const real = await importOriginal<typeof Carteira>();
  return {
    ...real,
    travarCarteiras: vi.fn(real.travarCarteiras),
    comprometer: vi.fn(real.comprometer),
    liberar: vi.fn(real.liberar),
  };
});

const CSRF = 'csrf-de-teste-do-lance';
const MIN = 60_000;
const HORA = 60 * MIN;
const PSEUDONIMO = /^Licitante #[0-9a-f]{6}$/;

interface Conta {
  readonly id: string;
  readonly cabecalhos: Readonly<Record<string, string>>;
}

interface Publicado {
  readonly tipo: keyof EventosDoServidor;
  readonly payload: unknown;
  readonly usuarioId?: string;
}

describe.skipIf(!INFRA_DISPONIVEL)('POST /api/lotes/{id}/lances (Postgres e Redis reais)', () => {
  let ctx: AppDeIdentidade;
  let pool: pg.Pool;
  let leiloeiroId: string;
  /** Eventos públicos (rooms `lote:{id}` e `vitrine`). */
  const publicados: Publicado[] = [];
  /** Eventos do room `usuario:{id}`, com o destinatário que o barramento entregou. */
  const privados: Publicado[] = [];

  beforeAll(async () => {
    ctx = await criarAppDeIdentidade();
    await registrarChaveDeAssinatura(ctx.app);
    pool = new pg.Pool(BANCO.conexao());
    leiloeiroId = (await inserirUsuario(pool, 'leiloeiro')).id;
    const publicador = ctx.app.get(PublicadorDeEventos);
    for (const tipo of ['lance_aceito', 'fim_estendido'] as const) {
      publicador.aoOcorrer(tipo, (payload, destino) => {
        publicados.push({ tipo, payload, ...destino });
      });
    }
    for (const tipo of ['voce_foi_superado', 'saldo_atualizado'] as const) {
      publicador.aoOcorrer(tipo, (payload, destino) => {
        privados.push({ tipo, payload, ...destino });
      });
    }
  });

  afterAll(async () => {
    await pool.end();
    await ctx.fechar();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    publicados.length = 0;
    privados.length = 0;
  });

  async function conta(papel: 'leiloeiro' | 'licitante' = 'licitante'): Promise<Conta> {
    const { id } = await inserirUsuario(pool, papel);
    const token = await emitirAccessToken(CHAVE_JWT, { id, papel });
    return {
      id,
      cabecalhos: { cookie: `access_token=${token}; csrf_token=${CSRF}`, 'x-csrf-token': CSRF },
    };
  }

  async function licitanteComSaldo(centavos = 1_000_000): Promise<Conta> {
    const nova = await conta();
    const resposta = await ctx.app.inject({
      method: 'POST',
      url: '/api/carteira/depositos',
      headers: { ...nova.cabecalhos, 'idempotency-key': randomUUID() },
      payload: { valorCentavos: centavos },
    });
    expect(resposta.statusCode).toBe(201);
    return nova;
  }

  /** Lote com lance inicial R$ 10,00 e incremento R$ 1,00; padrão ao vivo, termina em 1 h. */
  async function lote(extra: Record<string, string | number> = {}): Promise<string> {
    const criado = await inserirLote(pool, leiloeiroId, {
      lance_inicial_centavos: 1000,
      incremento_minimo_centavos: 100,
      ...extra,
    });
    return criado.id;
  }

  function lancar(
    quem: Conta | undefined,
    loteId: string,
    corpo: unknown,
    // null = sem o header.
    chave: string | null = randomUUID(),
  ): Promise<LightMyRequestResponse> {
    const headers: Record<string, string> = { ...(quem?.cabecalhos ?? {}) };
    if (chave !== null) headers['idempotency-key'] = chave;
    return ctx.app.inject({
      method: 'POST',
      url: `/api/lotes/${loteId}/lances`,
      headers,
      ...(typeof corpo === 'string'
        ? { payload: corpo, headers: { ...headers, 'content-type': 'application/json' } }
        : { payload: corpo as object }),
    });
  }

  function erro(resposta: LightMyRequestResponse): { codigo?: string; detalhes?: unknown } {
    return (resposta.json() as { erro?: { codigo?: string; detalhes?: unknown } }).erro ?? {};
  }

  async function saldo(
    quem: Conta,
  ): Promise<{ comprometidoCentavos: number; disponivelCentavos: number }> {
    const resposta = await ctx.app.inject({
      method: 'GET',
      url: '/api/carteira',
      headers: quem.cabecalhos,
    });
    return (
      resposta.json() as { dados: { comprometidoCentavos: number; disponivelCentavos: number } }
    ).dados;
  }

  async function contar(
    tabela: 'bids' | 'ledger_entries',
    coluna: string,
    valor: string,
  ): Promise<number> {
    const { rows } = await pool.query<{ n: string }>(
      `select count(*) as n from ${tabela} where ${coluna} = $1`,
      [valor],
    );
    return Number(rows[0]?.n);
  }

  async function estadoDoLote(
    loteId: string,
  ): Promise<{ total: number; lider: string | null; fim: Date }> {
    const { rows } = await pool.query<{
      total_lances: number;
      lider_id: string | null;
      fim_em: Date;
    }>('select total_lances, lider_id, fim_em from lots where id = $1', [loteId]);
    const linha = rows[0];
    if (linha === undefined) throw new Error('lote sumiu');
    return { total: linha.total_lances, lider: linha.lider_id, fim: linha.fim_em };
  }

  describe('caminho feliz', () => {
    it('primeiro lance: 201, compromete sem liberar e trava só a carteira do licitante', async () => {
      const a = await licitanteComSaldo();
      const loteId = await lote();
      const fimAntes = (await estadoDoLote(loteId)).fim;

      const resposta = await lancar(a, loteId, { valorCentavos: 1000 });

      expect(resposta.statusCode).toBe(201);
      const { dados } = resposta.json() as {
        dados: { lance: Record<string, unknown>; lote: Record<string, unknown> };
      };
      expect(dados.lance).toMatchObject({ seq: 1, valorCentavos: 1000 });
      expect(dados.lance['pseudonimo']).toMatch(PSEUDONIMO);
      expect(dados.lote).toEqual({
        lanceAtualCentavos: 1000,
        fimEm: fimAntes.toISOString(),
        totalLances: 1,
      });
      expect(resposta.body).not.toContain(a.id);
      expect(vi.mocked(travarCarteiras).mock.calls[0]?.[1]).toEqual([a.id]);
      expect(comprometer).toHaveBeenCalledTimes(1);
      expect(liberar).not.toHaveBeenCalled();
      expect(await saldo(a)).toMatchObject({ comprometidoCentavos: 1000 });
      expect(publicados.map((p) => p.tipo)).toEqual(['lance_aceito']);
      expect(publicados[0]?.usuarioId).toBeUndefined(); // público não tem destinatário
      // Sem líder anterior: nenhum voce_foi_superado; só o saldo do licitante, pós-commit.
      expect(privados).toEqual([
        {
          tipo: 'saldo_atualizado',
          usuarioId: a.id,
          payload: {
            totalCentavos: 1_000_000,
            comprometidoCentavos: 1000,
            disponivelCentavos: 999_000,
          },
        },
      ]);
    });

    it('superar: voce_foi_superado só ao anterior e saldo_atualizado aos dois, após o COMMIT', async () => {
      const a = await licitanteComSaldo(5000);
      const b = await licitanteComSaldo(20_000);
      const loteId = await lote();
      expect((await lancar(a, loteId, { valorCentavos: 1000 })).statusCode).toBe(201);
      privados.length = 0;

      expect((await lancar(b, loteId, { valorCentavos: 1100 })).statusCode).toBe(201);

      expect(privados).toEqual([
        {
          tipo: 'voce_foi_superado',
          usuarioId: a.id,
          payload: { loteId, valorCentavos: 1100 },
        },
        {
          tipo: 'saldo_atualizado',
          usuarioId: b.id,
          payload: {
            totalCentavos: 20_000,
            comprometidoCentavos: 1100,
            disponivelCentavos: 18_900,
          },
        },
        {
          tipo: 'saldo_atualizado',
          usuarioId: a.id,
          payload: { totalCentavos: 5000, comprometidoCentavos: 0, disponivelCentavos: 5000 },
        },
      ]);
      // Os saldos do evento batem com a carteira já confirmada.
      expect(await saldo(a)).toMatchObject(privados[2]?.payload ?? {});
      expect(await saldo(b)).toMatchObject(privados[1]?.payload ?? {});
      for (const evento of [...publicados, ...privados]) {
        expect(JSON.stringify(evento.payload)).not.toContain(a.id);
        expect(JSON.stringify(evento.payload)).not.toContain(b.id);
      }
    });

    it('superar: trava [novo, anterior] antes de comprometer e liberar; o valor volta ao anterior', async () => {
      const a = await licitanteComSaldo(5000);
      const b = await licitanteComSaldo();
      const loteId = await lote();
      expect((await lancar(a, loteId, { valorCentavos: 1000 })).statusCode).toBe(201);
      vi.clearAllMocks();

      const resposta = await lancar(b, loteId, { valorCentavos: 1100 });

      expect(resposta.statusCode).toBe(201);
      expect((resposta.json() as { dados: { lance: { seq: number } } }).dados.lance.seq).toBe(2);
      const trava = vi.mocked(travarCarteiras);
      expect(trava.mock.calls[0]?.[1]).toEqual([b.id, a.id]);
      const ordemDaTrava = trava.mock.invocationCallOrder[0] ?? Infinity;
      expect(ordemDaTrava).toBeLessThan(vi.mocked(comprometer).mock.invocationCallOrder[0] ?? 0);
      expect(ordemDaTrava).toBeLessThan(vi.mocked(liberar).mock.invocationCallOrder[0] ?? 0);
      expect(vi.mocked(liberar).mock.calls[0]?.[1]).toBe(a.id);
      expect(vi.mocked(liberar).mock.calls[0]?.[2]).toBe(1000);
      expect(await saldo(a)).toEqual(
        expect.objectContaining({ comprometidoCentavos: 0, disponivelCentavos: 5000 }),
      );
      expect(await saldo(b)).toMatchObject({ comprometidoCentavos: 1100 });
      expect(await estadoDoLote(loteId)).toMatchObject({ total: 2, lider: b.id });
    });
  });

  describe('recusas (422, specs/007 §Transação passo 3)', () => {
    it.each([
      [
        'LOTE_ENCERRADO (fim passou)',
        { inicio_em: iso(Date.now() - 2 * HORA), fim_em: iso(Date.now() - HORA) },
        'LOTE_ENCERRADO',
      ],
      ['LOTE_ENCERRADO (cancelado)', { status: 'cancelado' }, 'LOTE_ENCERRADO'],
      [
        'LOTE_NAO_INICIADO',
        {
          status: 'agendado',
          inicio_em: iso(Date.now() + HORA),
          fim_em: iso(Date.now() + 2 * HORA),
        },
        'LOTE_NAO_INICIADO',
      ],
    ])('%s', async (_nome, extra, codigo) => {
      const a = await licitanteComSaldo();
      const loteId = await lote(extra);

      const resposta = await lancar(a, loteId, { valorCentavos: 1000 });

      expect(resposta.statusCode).toBe(422);
      expect(erro(resposta).codigo).toBe(codigo);
      expect(await contar('bids', 'lote_id', loteId)).toBe(0);
    });

    it('JA_ESTA_GANHANDO', async () => {
      const a = await licitanteComSaldo();
      const loteId = await lote();
      await lancar(a, loteId, { valorCentavos: 1000 });

      const resposta = await lancar(a, loteId, { valorCentavos: 5000 });

      expect(resposta.statusCode).toBe(422);
      expect(erro(resposta).codigo).toBe('JA_ESTA_GANHANDO');
    });

    it('LANCE_ABAIXO_DO_MINIMO com detalhes.minimoCentavos', async () => {
      const [a, b] = [await licitanteComSaldo(), await licitanteComSaldo()];
      const loteId = await lote();
      await lancar(a, loteId, { valorCentavos: 1000 });

      const resposta = await lancar(b, loteId, { valorCentavos: 1099 });

      expect(resposta.statusCode).toBe(422);
      expect(erro(resposta)).toMatchObject({
        codigo: 'LANCE_ABAIXO_DO_MINIMO',
        detalhes: { minimoCentavos: 1100 },
      });
    });

    it('SALDO_INSUFICIENTE desfaz tudo: sem bids, ledger, extensão nem evento', async () => {
      const a = await licitanteComSaldo(1500);
      const pobre = await licitanteComSaldo(1000);
      const loteId = await lote({ fim_em: iso(Date.now() + MIN) });
      await lancar(a, loteId, { valorCentavos: 1000 });
      const antes = await estadoDoLote(loteId);
      publicados.length = 0;
      privados.length = 0;

      const resposta = await lancar(pobre, loteId, { valorCentavos: 1100 });

      expect(resposta.statusCode).toBe(422);
      expect(erro(resposta)).toEqual(
        expect.objectContaining({
          codigo: 'SALDO_INSUFICIENTE',
          detalhes: { disponivelCentavos: 1000 },
        }),
      );
      expect(await contar('bids', 'licitante_id', pobre.id)).toBe(0);
      expect(await contar('ledger_entries', 'user_id', pobre.id)).toBe(1); // só o depósito
      expect(await saldo(a)).toMatchObject({ comprometidoCentavos: 1000 }); // liberação desfeita
      expect(await estadoDoLote(loteId)).toEqual(antes);
      expect(publicados).toEqual([]);
      expect(privados).toEqual([]); // nem voce_foi_superado para `a`, nem saldo para ninguém
    });
  });

  describe('antes da transação', () => {
    it('anônimo com CSRF válido → 401 NAO_AUTENTICADO', async () => {
      const anonimo: Conta = {
        id: '',
        cabecalhos: { cookie: `csrf_token=${CSRF}`, 'x-csrf-token': CSRF },
      };
      const resposta = await lancar(anonimo, await lote(), { valorCentavos: 1000 });
      expect(resposta.statusCode).toBe(401);
      expect(erro(resposta).codigo).toBe('NAO_AUTENTICADO');
    });

    it('sem CSRF → 403 CSRF_INVALIDO, antes da sessão', async () => {
      const resposta = await lancar(undefined, await lote(), { valorCentavos: 1000 });
      expect(resposta.statusCode).toBe(403);
      expect(erro(resposta).codigo).toBe('CSRF_INVALIDO');
    });

    it('leiloeiro → 403 LEILOEIRO_NAO_PODE_LANCAR, antes da validação do corpo', async () => {
      const resposta = await lancar(await conta('leiloeiro'), await lote(), { errado: true }, null);
      expect(resposta.statusCode).toBe(403);
      expect(erro(resposta).codigo).toBe('LEILOEIRO_NAO_PODE_LANCAR');
    });

    it.each([randomUUID(), 'nao-e-uuid'])(
      'lote %s inexistente → 404 NAO_ENCONTRADO',
      async (id) => {
        const resposta = await lancar(await licitanteComSaldo(), id, { valorCentavos: 1000 });
        expect(resposta.statusCode).toBe(404);
        expect(erro(resposta).codigo).toBe('NAO_ENCONTRADO');
      },
    );

    it.each([
      ['valor 0', { valorCentavos: 0 }],
      ['valor fracionário', { valorCentavos: 10.5 }],
      ['valor em texto', { valorCentavos: '1000' }],
      ['campo desconhecido', { valorCentavos: 1000, extra: 1 }],
      ['valor acima do inteiro seguro', '{"valorCentavos": 9007199254740992}'],
    ])('%s → 422 DADOS_INVALIDOS', async (_nome, corpo) => {
      const resposta = await lancar(await licitanteComSaldo(), await lote(), corpo);
      expect(resposta.statusCode).toBe(422);
      expect(erro(resposta).codigo).toBe('DADOS_INVALIDOS');
    });

    it.each([null, 'nao-e-uuid'])('Idempotency-Key %s → 422 DADOS_INVALIDOS', async (chave) => {
      const resposta = await lancar(
        await licitanteComSaldo(),
        await lote(),
        { valorCentavos: 1000 },
        chave,
      );
      expect(resposta.statusCode).toBe(422);
      expect(erro(resposta).codigo).toBe('DADOS_INVALIDOS');
    });

    it('11 tentativas no mesmo segundo: a 11ª → 429 com Retry-After: 1', async () => {
      const a = await licitanteComSaldo();
      const inexistente = randomUUID();

      const respostas = await Promise.all(
        Array.from({ length: 11 }, () => lancar(a, inexistente, { valorCentavos: 1000 })),
      );

      const recusadas = respostas.filter((r) => r.statusCode === 429);
      expect(recusadas).toHaveLength(1);
      expect(recusadas[0]?.headers['retry-after']).toBe('1');
      expect(erro(recusadas[0] as LightMyRequestResponse).codigo).toBe('MUITAS_TENTATIVAS');
      expect(respostas.filter((r) => r.statusCode === 404)).toHaveLength(10);
    });
  });

  describe('idempotência (ADR 0031 D5)', () => {
    it('mesma chave, lote e valor → 200 com o lance original, sem efeito novo', async () => {
      const [a, b] = [await licitanteComSaldo(), await licitanteComSaldo()];
      const loteId = await lote();
      const chave = randomUUID();
      const primeira = await lancar(a, loteId, { valorCentavos: 1000 }, chave);
      await lancar(b, loteId, { valorCentavos: 1100 });
      publicados.length = 0;
      privados.length = 0;
      const lancamentos = await contar('ledger_entries', 'user_id', a.id);

      const repetida = await lancar(a, loteId, { valorCentavos: 1000 }, chave);

      expect(repetida.statusCode).toBe(200);
      const original = (primeira.json() as { dados: { lance: unknown } }).dados.lance;
      expect(repetida.json()).toEqual({
        sucesso: true,
        dados: {
          lance: original,
          lote: expect.objectContaining({ lanceAtualCentavos: 1100, totalLances: 2 }),
        },
      });
      expect(await contar('bids', 'lote_id', loteId)).toBe(2);
      expect(await contar('ledger_entries', 'user_id', a.id)).toBe(lancamentos);
      expect(publicados).toEqual([]);
      expect(privados).toEqual([]);
    });

    it('mesma chave com outro valor ou outro lote → 422 DADOS_INVALIDOS', async () => {
      const a = await licitanteComSaldo();
      const [loteId, outroLote] = [await lote(), await lote()];
      const chave = randomUUID();
      await lancar(a, loteId, { valorCentavos: 1000 }, chave);

      const outroValor = await lancar(a, loteId, { valorCentavos: 1200 }, chave);
      const noOutroLote = await lancar(a, outroLote, { valorCentavos: 1000 }, chave);

      expect([outroValor.statusCode, noOutroLote.statusCode]).toEqual([422, 422]);
      expect(erro(outroValor).codigo).toBe('DADOS_INVALIDOS');
      expect(erro(noOutroLote).codigo).toBe('DADOS_INVALIDOS');
      expect(await contar('bids', 'lote_id', outroLote)).toBe(0);
    });
  });

  describe('anti-sniping (ADR 0031 D10)', () => {
    it('a 1 min do fim: estende para agora + 2 min e publica fim_estendido', async () => {
      const a = await licitanteComSaldo();
      const loteId = await lote({ fim_em: iso(Date.now() + MIN) });

      const resposta = await lancar(a, loteId, { valorCentavos: 1000 });

      expect(resposta.statusCode).toBe(201);
      const dados = (
        resposta.json() as { dados: { lance: { criadoEm: string }; lote: { fimEm: string } } }
      ).dados;
      expect(Date.parse(dados.lote.fimEm) - Date.parse(dados.lance.criadoEm)).toBe(2 * MIN);
      expect(publicados.map((p) => p.tipo)).toEqual(['lance_aceito', 'fim_estendido']);
    });

    it('a 3 min do fim: não estende', async () => {
      const a = await licitanteComSaldo();
      const loteId = await lote({ fim_em: iso(Date.now() + 3 * MIN) });
      const fim = (await estadoDoLote(loteId)).fim;

      const resposta = await lancar(a, loteId, { valorCentavos: 1000 });

      expect((resposta.json() as { dados: { lote: { fimEm: string } } }).dados.lote.fimEm).toBe(
        fim.toISOString(),
      );
      expect(publicados.map((p) => p.tipo)).toEqual(['lance_aceito']);
    });
  });

  describe('lock do lote e concorrência leve (notas da 074 e da 078)', () => {
    it('anexar espera o FOR UPDATE do lote: nada em bids enquanto outro segura o lock', async () => {
      const a = await licitanteComSaldo();
      const loteId = await lote();
      const cliente = await pool.connect();
      try {
        await cliente.query('begin');
        await cliente.query('select id from lots where id = $1 for update', [loteId]);
        const pendente = lancar(a, loteId, { valorCentavos: 1000 });
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(await contar('bids', 'lote_id', loteId)).toBe(0);
        await cliente.query('commit');
        expect((await pendente).statusCode).toBe(201);
      } finally {
        cliente.release();
      }
    });

    it('lances simultâneos no mesmo lote: seq contígua e cadeia encadeada', async () => {
      const contas = await Promise.all([1, 2, 3, 4, 5].map(() => licitanteComSaldo()));
      const loteId = await lote();

      const respostas = await Promise.all(
        contas.map((c, i) => lancar(c, loteId, { valorCentavos: 1000 + i * 1000 })),
      );

      const aceitos = respostas.filter((r) => r.statusCode === 201).length;
      expect(aceitos).toBeGreaterThanOrEqual(1);
      expect(respostas.every((r) => r.statusCode === 201 || r.statusCode === 422)).toBe(true);
      const { rows } = await pool.query<{ seq: number; hash_anterior: Buffer; hash: Buffer }>(
        'select seq, hash_anterior, hash from bids where lote_id = $1 order by seq',
        [loteId],
      );
      expect(rows.map((r) => r.seq)).toEqual(Array.from({ length: aceitos }, (_, i) => i + 1));
      for (let i = 1; i < rows.length; i++) {
        expect(rows[i]?.hash_anterior.equals(rows[i - 1]?.hash ?? Buffer.alloc(0))).toBe(true);
      }
      expect((await estadoDoLote(loteId)).total).toBe(aceitos);
    });

    it('lotes cruzados em ordem inversa (X lidera o 2, Y o 1) não dão deadlock', async () => {
      const [x, y] = [await licitanteComSaldo(), await licitanteComSaldo()];
      const [lote1, lote2] = [await lote(), await lote()];
      await lancar(y, lote1, { valorCentavos: 1000 });
      await lancar(x, lote2, { valorCentavos: 1000 });

      const respostas = await Promise.all([
        lancar(x, lote1, { valorCentavos: 1100 }),
        lancar(y, lote2, { valorCentavos: 1100 }),
      ]);

      expect(respostas.map((r) => r.statusCode)).toEqual([201, 201]);
      expect(await saldo(x)).toMatchObject({ comprometidoCentavos: 1100 });
      expect(await saldo(y)).toMatchObject({ comprometidoCentavos: 1100 });
    });
  });
});
