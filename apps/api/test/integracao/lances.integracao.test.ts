// Bateria de aceite dos lances (tarefa 087; specs/007 §Critérios de aceite). Postgres e Redis reais,
// tudo pelo POST /api/lotes/{id}/lances e pelas leituras públicas; o relógio do lote é ajustado por
// SQL, relativo ao `clock_timestamp()` do Postgres (helpers/lances-por-sql.ts). Cada recusa prova
// também que nada foi escrito: nenhum lance, lançamento, extensão, mudança de saldo nem evento.
// Fora daqui, por já terem arquivo: o caminho feliz e a ordem dos locks
// (modules/lances/aceitar-lance.integracao.test.ts), a concorrência (lances-concorrencia) e a
// paginação com 55 lances semeados (modules/lances/leituras.integracao.test.ts).
// O instante exato de 2 min do fim não é alcançável pelo relógio real (a hora do lance é lida
// dentro da transação): a fronteira exata fica em modules/lances/regras.test.ts e aqui se testa
// 2 min − TOLERANCIA_ABAIXO_MS e 2 min + FOLGA_ACIMA_MS.
import { randomUUID } from 'node:crypto';
import { setTimeout as esperar } from 'node:timers/promises';

import type { EventosDoServidor } from '@leilao/contracts';
import type { LightMyRequestResponse } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PublicadorDeEventos } from '../../src/common/eventos/publicador-de-eventos.js';
import { LeiturasDeLances, registrarChaveDeAssinatura } from '../../src/modules/lances/index.js';
import {
  contagemDoLote,
  dadosDosUsuarios,
  encerrarPorSql,
  estadoDoLote,
  terminarEm,
} from '../helpers/lances-por-sql.js';
import { inserirUsuario, iso } from '../helpers/lotes-por-sql.js';
import { TIMEOUT_LONGO_MS } from '../helpers/timeouts.js';
import {
  type AppDeIdentidade,
  BANCO,
  criarAppDeIdentidade,
  INFRA_DISPONIVEL,
} from '../modules/identidade/ambiente.js';
import {
  type ApoioDeLances,
  type Conta,
  criarApoioDeLances,
  erro,
  INCREMENTO_CENTAVOS,
  LANCE_INICIAL_CENTAVOS,
} from './apoio-de-lances.js';

const MIN = 60_000;
const HORA = 60 * MIN;
const JANELA_DO_ANTI_SNIPING_MS = 2 * MIN;
/**
 * Abaixo de 2 min (fim − 1,5 s): o tempo que passa entre o ajuste do relógio e a leitura dentro da
 * transação só aproxima o lance do fim, então o lote estende em qualquer atraso.
 */
const TOLERANCIA_ABAIXO_MS = 1500;
/**
 * Acima de 2 min (fim + 5 s): "mais de 2 min não estende" só vale se o atraso entre o ajuste do
 * relógio e a leitura na transação ficar abaixo desta folga; 5 s aguenta uma máquina sob carga.
 */
const FOLGA_ACIMA_MS = 5000;
const JANELA_DO_LIMITE_MS = 1000;
/** Margem sobre a janela de 1 s: a rajada só vale se terminou antes de `JANELA − MARGEM`. */
const MARGEM_DA_RAJADA_MS = 200;
const TENTATIVAS_DA_RAJADA = 5;
const LIMITE_POR_SEGUNDO = 10;
const LICITANTES_DA_PAGINACAO = 20;
const LANCES_DA_PAGINACAO = 55;
const POR_PAGINA_DO_HISTORICO = 50;
const PSEUDONIMO = /^Licitante #[0-9a-f]{6}$/;

interface LanceJson {
  readonly seq: number;
  readonly pseudonimo: string;
  readonly valorCentavos: number;
  readonly criadoEm: string;
}

interface DadosDoLance {
  readonly lance: LanceJson;
  readonly lote: { lanceAtualCentavos: number; fimEm: string; totalLances: number };
}

interface ListaJson<T> {
  readonly dados: readonly T[];
  readonly meta: { readonly total: number; readonly pagina: number; readonly limite: number };
}

interface ItemDeMeusLances {
  readonly lote: { readonly id: string };
  readonly posicao: string;
  readonly meuMaiorLanceCentavos: number;
  readonly meuUltimoLanceEm: string;
}

interface Publicado {
  readonly tipo: keyof EventosDoServidor;
  readonly usuarioId?: string;
}

describe.skipIf(!INFRA_DISPONIVEL)('aceite dos lances (Postgres e Redis reais)', () => {
  let ctx: AppDeIdentidade;
  let pool: pg.Pool;
  let apoio: ApoioDeLances;
  let leituras: LeiturasDeLances;
  /** Todo evento publicado depois do COMMIT, público ou privado. */
  const eventos: Publicado[] = [];

  beforeAll(async () => {
    ctx = await criarAppDeIdentidade();
    await registrarChaveDeAssinatura(ctx.app);
    pool = new pg.Pool(BANCO.conexao());
    const leiloeiro = await inserirUsuario(pool, 'leiloeiro');
    apoio = criarApoioDeLances(ctx, pool, leiloeiro.id);
    leituras = ctx.app.get(LeiturasDeLances);
    const publicador = ctx.app.get(PublicadorDeEventos);
    for (const tipo of [
      'lance_aceito',
      'fim_estendido',
      'voce_foi_superado',
      'saldo_atualizado',
    ] as const) {
      publicador.aoOcorrer(tipo, (_payload, destino) => {
        eventos.push({ tipo, ...destino });
      });
    }
  });

  afterAll(async () => {
    const poolAberto = pool as pg.Pool | undefined;
    const appAberto = ctx as AppDeIdentidade | undefined;
    try {
      await poolAberto?.end();
    } finally {
      await appAberto?.fechar();
    }
  });

  beforeEach(() => {
    eventos.length = 0;
  });

  // --- apoio local ---------------------------------------------------------------------------

  async function licitante(centavos = 1_000_000): Promise<Conta> {
    return (await apoio.licitantesComSaldo(1, centavos))[0] as Conta;
  }

  /** POST com corpo e `Idempotency-Key` livres (`null` = sem o header). */
  function lancarCru(
    quem: Conta,
    loteId: string,
    corpo: object,
    chave: string | null = randomUUID(),
  ): Promise<LightMyRequestResponse> {
    return ctx.app.inject({
      method: 'POST',
      url: `/api/lotes/${loteId}/lances`,
      headers: { ...quem.cabecalhos, ...(chave === null ? {} : { 'idempotency-key': chave }) },
      payload: corpo,
    });
  }

  const dadosDe = (resposta: LightMyRequestResponse): DadosDoLance =>
    resposta.json<{ dados: DadosDoLance }>().dados;

  /** Lance que precisa ser aceito (201): devolve o corpo. */
  async function aceitar(quem: Conta, loteId: string, valor: number): Promise<DadosDoLance> {
    const resposta = await apoio.lancar(quem, loteId, valor);
    expect(resposta.statusCode, resposta.body).toBe(201);
    return dadosDe(resposta);
  }

  function obter(url: string, quem?: Conta): Promise<LightMyRequestResponse> {
    return ctx.app.inject({ method: 'GET', url, headers: quem?.cabecalhos ?? {} });
  }

  async function carteira(quem: Conta): Promise<{ total: string; comprometido: string }> {
    const { rows } = await pool.query<{ total: string; comprometido: string }>(
      `select total_centavos::text as total, comprometido_centavos::text as comprometido
         from wallet_balances where user_id = $1`,
      [quem.id],
    );
    return rows[0] ?? { total: '0', comprometido: '0' };
  }

  /**
   * Executa `acao` e exige que nada tenha sido escrito: lote (lance atual, líder, total, fim),
   * `bids`, ledger, as carteiras de `afetados` e os eventos ficam exatamente como estavam.
   */
  async function semEscrever(
    loteId: string,
    afetados: readonly Conta[],
    acao: () => Promise<LightMyRequestResponse>,
  ): Promise<LightMyRequestResponse> {
    const fotografia = async () => ({
      lote: await estadoDoLote(pool, loteId),
      contagem: await contagemDoLote(pool, loteId),
      carteiras: await Promise.all(afetados.map(carteira)),
    });
    const antes = await fotografia();
    eventos.length = 0;

    const resposta = await acao();

    expect(await fotografia()).toEqual(antes);
    expect(eventos).toEqual([]);
    return resposta;
  }

  async function recusar(
    codigo: string,
    loteId: string,
    quem: Conta,
    valor: number,
    afetados: readonly Conta[] = [quem],
  ): Promise<LightMyRequestResponse> {
    const resposta = await semEscrever(loteId, afetados, () => apoio.lancar(quem, loteId, valor));
    expect(resposta.statusCode, resposta.body).toBe(422);
    expect(erro(resposta).codigo).toBe(codigo);
    return resposta;
  }

  /**
   * Rajada determinística contra o rate limit de janela fixa de 1 s (a chave do contador nasce no
   * primeiro INCR e expira 1 s depois). `preparar` cria o que a rajada usa (conta, lote) fora do
   * cronômetro; o contador do app é zerado logo antes de `disparar`, então a janela só começa
   * dentro da rajada. Todo INCR cai entre o início e o fim de `disparar`: se ela durou menos que a
   * janela menos uma margem, a rajada coube inteira numa janela. Caso contrário, repete com
   * `preparar` de novo, no máximo `TENTATIVAS_DA_RAJADA` vezes.
   * Causa da instabilidade: sob carga a rajada passava de 800 ms e uma tentativa só valia a janela
   * de 1 s; por isso as 5 tentativas cabem no `TIMEOUT_LONGO_MS` dos testes de limite, não nos 5 s.
   */
  async function rajadaNumaJanela<P, R>(
    preparar: () => Promise<P>,
    disparar: (preparado: P) => Promise<R>,
  ): Promise<{ preparado: P; resultado: R }> {
    const duracaoMaxima = JANELA_DO_LIMITE_MS - MARGEM_DA_RAJADA_MS;
    for (let tentativa = 1; tentativa <= TENTATIVAS_DA_RAJADA; tentativa += 1) {
      const preparado = await preparar();
      await ctx.resetarLimite();
      const inicio = performance.now();
      const resultado = await disparar(preparado);
      if (performance.now() - inicio <= duracaoMaxima) return { preparado, resultado };
    }
    throw new Error(
      `nenhuma das ${TENTATIVAS_DA_RAJADA} rajadas coube em ${duracaoMaxima} ms: máquina sobrecarregada`,
    );
  }

  /** Nenhum id, nome nem e-mail de usuário no corpo, nem chave que os insinue. */
  async function semDadosDeUsuario(corpo: string, quem: readonly Conta[]): Promise<void> {
    for (const usuario of await dadosDosUsuarios(
      pool,
      quem.map((c) => c.id),
    )) {
      expect(corpo).not.toContain(usuario.id);
      expect(corpo).not.toContain(usuario.nome);
      expect(corpo).not.toContain(usuario.email);
    }
    expect(corpo).not.toMatch(/licitante_?id|liderId|vencedorId|userId|"email"|"nome"/i);
  }

  // --- recusas -------------------------------------------------------------------------------

  describe('os 6 códigos de recusa (422), com os campos extras e sem efeito', () => {
    it('LOTE_ENCERRADO: fim vencido, mesmo com o status gravado ainda ao_vivo', async () => {
      const a = await licitante();
      const loteId = await apoio.lote();
      await encerrarPorSql(pool, loteId, { status: 'ao_vivo' });

      const resposta = await recusar('LOTE_ENCERRADO', loteId, a, LANCE_INICIAL_CENTAVOS);

      expect(erro(resposta).detalhes ?? {}).toEqual({});
    });

    it('LOTE_ENCERRADO: lote cancelado, com o fim ainda no futuro', async () => {
      const a = await licitante();
      const loteId = await apoio.lote({ status: 'cancelado' });

      await recusar('LOTE_ENCERRADO', loteId, a, LANCE_INICIAL_CENTAVOS);
    });

    it('LOTE_NAO_INICIADO: agora antes de inicio_em', async () => {
      const a = await licitante();
      const loteId = await apoio.lote({
        status: 'agendado',
        inicio_em: iso(Date.now() + HORA),
        fim_em: iso(Date.now() + 2 * HORA),
      });

      await recusar('LOTE_NAO_INICIADO', loteId, a, LANCE_INICIAL_CENTAVOS);
    });

    it('JA_ESTA_GANHANDO: o líder não cobre o próprio lance, nem com valor muito maior', async () => {
      const a = await licitante();
      const loteId = await apoio.lote();
      await aceitar(a, loteId, LANCE_INICIAL_CENTAVOS);

      await recusar('JA_ESTA_GANHANDO', loteId, a, 50_000);
    });

    it('LANCE_ABAIXO_DO_MINIMO no primeiro lance: detalhes.minimoCentavos = lance inicial', async () => {
      const a = await licitante();
      const loteId = await apoio.lote();

      const resposta = await recusar(
        'LANCE_ABAIXO_DO_MINIMO',
        loteId,
        a,
        LANCE_INICIAL_CENTAVOS - 1,
      );

      expect(erro(resposta).detalhes).toEqual({ minimoCentavos: LANCE_INICIAL_CENTAVOS });
    });

    it('LANCE_ABAIXO_DO_MINIMO nos seguintes: detalhes.minimoCentavos = atual + incremento', async () => {
      const [a, b] = await apoio.licitantesComSaldo(2);
      const loteId = await apoio.lote();
      await aceitar(a as Conta, loteId, LANCE_INICIAL_CENTAVOS);
      const minimo = LANCE_INICIAL_CENTAVOS + INCREMENTO_CENTAVOS;

      const resposta = await recusar('LANCE_ABAIXO_DO_MINIMO', loteId, b as Conta, minimo - 1, [
        a as Conta,
        b as Conta,
      ]);

      expect(erro(resposta).detalhes).toEqual({ minimoCentavos: minimo });
      // O mínimo exato é aceito: a fronteira é inclusiva.
      expect((await apoio.lancar(b as Conta, loteId, minimo)).statusCode).toBe(201);
    });

    it('SALDO_INSUFICIENTE: detalhes.disponivelCentavos, sem tirar o valor do líder anterior', async () => {
      const a = await licitante(1500);
      const pobre = await licitante(1000);
      const loteId = await apoio.lote();
      await aceitar(a, loteId, LANCE_INICIAL_CENTAVOS);

      const resposta = await recusar('SALDO_INSUFICIENTE', loteId, pobre, 1100, [a, pobre]);

      expect(erro(resposta).detalhes).toEqual({ disponivelCentavos: 1000 });
      expect((await carteira(a)).comprometido).toBe(String(LANCE_INICIAL_CENTAVOS));
    });

    it('SALDO_INSUFICIENTE no primeiro lance do lote (sem líder anterior)', async () => {
      const a = await licitante(LANCE_INICIAL_CENTAVOS - 1);
      const loteId = await apoio.lote();

      const resposta = await recusar('SALDO_INSUFICIENTE', loteId, a, LANCE_INICIAL_CENTAVOS);

      expect(erro(resposta).detalhes).toEqual({ disponivelCentavos: LANCE_INICIAL_CENTAVOS - 1 });
    });

    it('lance igual ao saldo disponível cabe (comprometido = total)', async () => {
      const a = await licitante(LANCE_INICIAL_CENTAVOS);
      const loteId = await apoio.lote();

      await aceitar(a, loteId, LANCE_INICIAL_CENTAVOS);

      expect(await carteira(a)).toEqual({
        total: String(LANCE_INICIAL_CENTAVOS),
        comprometido: String(LANCE_INICIAL_CENTAVOS),
      });
    });
  });

  describe('ordem das verificações da transação (specs/007 §Transação, passo 3)', () => {
    it('LOTE_ENCERRADO vem antes de JA_ESTA_GANHANDO e de LANCE_ABAIXO_DO_MINIMO', async () => {
      const a = await licitante();
      const loteId = await apoio.lote();
      await aceitar(a, loteId, LANCE_INICIAL_CENTAVOS);
      await encerrarPorSql(pool, loteId, { status: 'ao_vivo' });

      await recusar('LOTE_ENCERRADO', loteId, a, 1);
    });

    it('JA_ESTA_GANHANDO vem antes de LANCE_ABAIXO_DO_MINIMO', async () => {
      const a = await licitante();
      const loteId = await apoio.lote();
      await aceitar(a, loteId, LANCE_INICIAL_CENTAVOS);

      await recusar('JA_ESTA_GANHANDO', loteId, a, 1);
    });

    it('LANCE_ABAIXO_DO_MINIMO vem antes de SALDO_INSUFICIENTE', async () => {
      const [a, pobre] = await Promise.all([licitante(), licitante(500)]);
      const loteId = await apoio.lote();
      await aceitar(a, loteId, LANCE_INICIAL_CENTAVOS);

      // 1050 está abaixo do mínimo (1100) e também acima do saldo de 500.
      await recusar('LANCE_ABAIXO_DO_MINIMO', loteId, pobre, 1050, [a, pobre]);
    });
  });

  describe('lote inexistente', () => {
    it.each([randomUUID(), 'nao-e-uuid', '123'])('lote %s → 404 NAO_ENCONTRADO', async (id) => {
      const a = await licitante();

      const resposta = await lancarCru(a, id, { valorCentavos: LANCE_INICIAL_CENTAVOS });

      expect(resposta.statusCode).toBe(404);
      expect(erro(resposta).codigo).toBe('NAO_ENCONTRADO');
      expect(eventos).toEqual([]);
    });
  });

  // --- posição -------------------------------------------------------------------------------

  describe('posição do usuário (specs/007 §Posição do usuário no lote)', () => {
    type Cenario =
      'ganhando' | 'superado' | 'venceu' | 'perdeu' | 'vencidoLider' | 'vencidoSuperado';
    const ESPERADA: Readonly<Record<Cenario, string>> = {
      ganhando: 'ganhando',
      superado: 'superado',
      venceu: 'venceu',
      perdeu: 'perdeu',
      // Fim vencido e vencedor ainda não gravado pelo job da F4.
      vencidoLider: 'ganhando',
      vencidoSuperado: 'perdeu',
    };
    const MEU_MAIOR: Readonly<Record<Cenario, number>> = {
      ganhando: 1200,
      superado: 1000,
      venceu: 1000,
      perdeu: 1000,
      vencidoLider: 1000,
      vencidoSuperado: 1000,
    };
    const lotes = {} as Record<Cenario | 'semLance' | 'agendado', string>;
    let eu: Conta;
    let outro: Conta;
    let meusLances: ItemDeMeusLances[];

    beforeAll(async () => {
      [eu, outro] = (await apoio.licitantesComSaldo(2)) as [Conta, Conta];
      const novo = async (cenario: Cenario): Promise<string> => {
        lotes[cenario] = await apoio.lote();
        return lotes[cenario];
      };
      let id = await novo('ganhando');
      await aceitar(eu, id, 1000);
      await aceitar(outro, id, 1100);
      await aceitar(eu, id, 1200);

      id = await novo('superado');
      await aceitar(eu, id, 1000);
      await aceitar(outro, id, 1100);

      id = await novo('venceu');
      await aceitar(eu, id, 1000);
      await encerrarPorSql(pool, id, { status: 'encerrado', vencedorId: eu.id });

      id = await novo('perdeu');
      await aceitar(eu, id, 1000);
      await aceitar(outro, id, 1100);
      await encerrarPorSql(pool, id, { status: 'encerrado', vencedorId: outro.id });

      id = await novo('vencidoLider');
      await aceitar(eu, id, 1000);
      await encerrarPorSql(pool, id, { status: 'ao_vivo' });

      id = await novo('vencidoSuperado');
      await aceitar(eu, id, 1000);
      await aceitar(outro, id, 1100);
      await encerrarPorSql(pool, id, { status: 'ao_vivo' });

      lotes.semLance = await apoio.lote();
      await aceitar(outro, lotes.semLance, 1000);
      lotes.agendado = await apoio.lote({
        status: 'agendado',
        inicio_em: iso(Date.now() + HORA),
        fim_em: iso(Date.now() + 2 * HORA),
      });

      const resposta = await obter('/api/me/lances', eu);
      expect(resposta.statusCode).toBe(200);
      meusLances = resposta.json<ListaJson<ItemDeMeusLances>>().dados.slice();
    }, TIMEOUT_LONGO_MS);

    it.each(Object.entries(ESPERADA) as [Cenario, string][])(
      'GET /api/me/lances: lote %s → %s',
      (cenario, esperada) => {
        const item = meusLances.find((i) => i.lote.id === lotes[cenario]);

        expect(item?.posicao).toBe(esperada);
        expect(item?.meuMaiorLanceCentavos).toBe(MEU_MAIOR[cenario]);
      },
    );

    it.each(Object.entries(ESPERADA) as [Cenario, string][])(
      'posicaoDoUsuario: lote %s → %s',
      async (cenario, esperada) => {
        expect(await leituras.posicaoDoUsuario(lotes[cenario], eu.id)).toBe(esperada);
      },
    );

    it('sem_lance: lote ao vivo com lance só do outro, lote agendado e lote inexistente', async () => {
      for (const id of [lotes.semLance, lotes.agendado, randomUUID()]) {
        expect(await leituras.posicaoDoUsuario(id, eu.id)).toBe('sem_lance');
      }
      const ids = meusLances.map((i) => i.lote.id);
      expect(ids).not.toContain(lotes.semLance);
      expect(ids).not.toContain(lotes.agendado);
    });

    it('a posição é por usuário: o outro lidera onde `eu` foi superado', async () => {
      expect(await leituras.posicaoDoUsuario(lotes.superado, outro.id)).toBe('ganhando');
      expect(await leituras.posicaoDoUsuario(lotes.perdeu, outro.id)).toBe('venceu');
      expect(await leituras.posicaoDoUsuario(lotes.vencidoSuperado, outro.id)).toBe('ganhando');
    });
  });

  // --- anti-sniping --------------------------------------------------------------------------

  describe('anti-sniping (RF-05, ADR 0031 D10)', () => {
    /** Lote que termina daqui a `ms`; o relógio é ajustado só depois de criar as contas. */
    async function loteQueTerminaEm(ms: number): Promise<string> {
      const loteId = await apoio.lote();
      await terminarEm(pool, loteId, ms);
      return loteId;
    }

    const duracaoRestante = (d: DadosDoLance): number =>
      Date.parse(d.lote.fimEm) - Date.parse(d.lance.criadoEm);

    it('a 1 min do fim: o fim vira exatamente agora + 2 min; fim_original_em não muda', async () => {
      const a = await licitante();
      const loteId = await loteQueTerminaEm(MIN);
      const antes = await estadoDoLote(pool, loteId);

      const dados = await aceitar(a, loteId, LANCE_INICIAL_CENTAVOS);

      expect(duracaoRestante(dados)).toBe(JANELA_DO_ANTI_SNIPING_MS);
      const depois = await estadoDoLote(pool, loteId);
      expect(depois.fimEm.toISOString()).toBe(dados.lote.fimEm);
      expect(depois.fimEm.getTime()).toBeGreaterThan(antes.fimEm.getTime());
      expect(depois.fimOriginalEm).toEqual(antes.fimOriginalEm);
      expect(eventos.map((e) => e.tipo)).toContain('fim_estendido');
    });

    it('a 3 min do fim: o fim não muda e não há fim_estendido', async () => {
      const a = await licitante();
      const loteId = await loteQueTerminaEm(3 * MIN);
      const antes = await estadoDoLote(pool, loteId);

      const dados = await aceitar(a, loteId, LANCE_INICIAL_CENTAVOS);

      expect(dados.lote.fimEm).toBe(antes.fimEm.toISOString());
      expect((await estadoDoLote(pool, loteId)).fimEm).toEqual(antes.fimEm);
      expect(eventos.map((e) => e.tipo)).not.toContain('fim_estendido');
    });

    it('acima de 2 min (+ 5 s de folga): não estende', async () => {
      const a = await licitante();
      const loteId = await loteQueTerminaEm(JANELA_DO_ANTI_SNIPING_MS + FOLGA_ACIMA_MS);
      const antes = await estadoDoLote(pool, loteId);

      const dados = await aceitar(a, loteId, LANCE_INICIAL_CENTAVOS);

      expect(dados.lote.fimEm).toBe(antes.fimEm.toISOString());
      expect(eventos.map((e) => e.tipo)).not.toContain('fim_estendido');
    });

    it('abaixo de 2 min (− 1,5 s): estende para agora + 2 min', async () => {
      const a = await licitante();
      const loteId = await loteQueTerminaEm(JANELA_DO_ANTI_SNIPING_MS - TOLERANCIA_ABAIXO_MS);

      const dados = await aceitar(a, loteId, LANCE_INICIAL_CENTAVOS);

      expect(duracaoRestante(dados)).toBe(JANELA_DO_ANTI_SNIPING_MS);
      expect(eventos.map((e) => e.tipo)).toContain('fim_estendido');
    });

    it('cada lance dentro da janela estende de novo, e o fim nunca recua', async () => {
      const [a, b] = (await apoio.licitantesComSaldo(2)) as [Conta, Conta];
      const loteId = await loteQueTerminaEm(MIN);
      const primeiro = await aceitar(a, loteId, LANCE_INICIAL_CENTAVOS);
      eventos.length = 0;

      const segundo = await aceitar(b, loteId, LANCE_INICIAL_CENTAVOS + INCREMENTO_CENTAVOS);

      expect(duracaoRestante(segundo)).toBe(JANELA_DO_ANTI_SNIPING_MS);
      expect(Date.parse(segundo.lote.fimEm)).toBeGreaterThanOrEqual(
        Date.parse(primeiro.lote.fimEm),
      );
      expect(eventos.map((e) => e.tipo)).toContain('fim_estendido');
    });

    it('lance recusado dentro da janela não estende o fim', async () => {
      const a = await licitante();
      const loteId = await loteQueTerminaEm(MIN);

      await recusar('LANCE_ABAIXO_DO_MINIMO', loteId, a, LANCE_INICIAL_CENTAVOS - 1);
    });
  });

  // --- idempotência --------------------------------------------------------------------------

  describe('idempotência (ADR 0031 D5)', () => {
    it('repetir chave, lote e valor → 200 com o lance original; sem lance, lançamento, extensão nem evento', async () => {
      const a = await licitante();
      const loteId = await apoio.lote();
      await terminarEm(pool, loteId, MIN);
      const chave = randomUUID();
      const primeira = await apoio.lancar(a, loteId, LANCE_INICIAL_CENTAVOS, chave);
      expect(primeira.statusCode).toBe(201);

      const repetida = await semEscrever(loteId, [a], () =>
        apoio.lancar(a, loteId, LANCE_INICIAL_CENTAVOS, chave),
      );

      expect(repetida.statusCode).toBe(200);
      const original = dadosDe(primeira);
      const agora = dadosDe(repetida);
      expect(agora.lance).toEqual(original.lance);
      // O `lote` é o de agora: o fim já estendido pelo lance original, sem nova extensão.
      expect(agora.lote).toEqual({
        lanceAtualCentavos: LANCE_INICIAL_CENTAVOS,
        fimEm: original.lote.fimEm,
        totalLances: 1,
      });
    });

    it('a repetição devolve o lote de agora, mesmo depois de o lance ser superado', async () => {
      const [a, b] = (await apoio.licitantesComSaldo(2)) as [Conta, Conta];
      const loteId = await apoio.lote();
      const chave = randomUUID();
      const primeira = await apoio.lancar(a, loteId, LANCE_INICIAL_CENTAVOS, chave);
      await aceitar(b, loteId, LANCE_INICIAL_CENTAVOS + INCREMENTO_CENTAVOS);

      const repetida = await semEscrever(loteId, [a, b], () =>
        apoio.lancar(a, loteId, LANCE_INICIAL_CENTAVOS, chave),
      );

      expect(repetida.statusCode).toBe(200);
      expect(dadosDe(repetida).lance).toEqual(dadosDe(primeira).lance);
      expect(dadosDe(repetida).lote).toMatchObject({
        lanceAtualCentavos: LANCE_INICIAL_CENTAVOS + INCREMENTO_CENTAVOS,
        totalLances: 2,
      });
    });

    it('mesma chave com outro valor → 422 DADOS_INVALIDOS, sem efeito', async () => {
      const a = await licitante();
      const loteId = await apoio.lote();
      const chave = randomUUID();
      await apoio.lancar(a, loteId, LANCE_INICIAL_CENTAVOS, chave);

      const resposta = await semEscrever(loteId, [a], () =>
        apoio.lancar(a, loteId, LANCE_INICIAL_CENTAVOS + 500, chave),
      );

      expect(resposta.statusCode).toBe(422);
      expect(erro(resposta).codigo).toBe('DADOS_INVALIDOS');
    });

    it('mesma chave em outro lote → 422 DADOS_INVALIDOS, sem lance no outro lote', async () => {
      const a = await licitante();
      const [loteId, outroLote] = [await apoio.lote(), await apoio.lote()];
      const chave = randomUUID();
      await apoio.lancar(a, loteId, LANCE_INICIAL_CENTAVOS, chave);

      const resposta = await semEscrever(outroLote, [a], () =>
        apoio.lancar(a, outroLote, LANCE_INICIAL_CENTAVOS, chave),
      );

      expect(resposta.statusCode).toBe(422);
      expect(erro(resposta).codigo).toBe('DADOS_INVALIDOS');
    });

    it.each([
      ['ausente', null],
      ['que não é UUID', 'nao-e-uuid'],
      ['vazia', ''],
    ])('Idempotency-Key %s → 422 DADOS_INVALIDOS, sem efeito', async (_nome, chave) => {
      const a = await licitante();
      const loteId = await apoio.lote();

      const resposta = await semEscrever(loteId, [a], () =>
        lancarCru(a, loteId, { valorCentavos: LANCE_INICIAL_CENTAVOS }, chave),
      );

      expect(resposta.statusCode).toBe(422);
      expect(erro(resposta).codigo).toBe('DADOS_INVALIDOS');
    });

    it('recusa não grava a chave: repetir a chave de um lance recusado reavalia as regras', async () => {
      const a = await licitante();
      const loteId = await apoio.lote();
      const chave = randomUUID();
      const recusado = await apoio.lancar(a, loteId, LANCE_INICIAL_CENTAVOS - 1, chave);
      expect(erro(recusado).codigo).toBe('LANCE_ABAIXO_DO_MINIMO');

      const reavaliado = await apoio.lancar(a, loteId, LANCE_INICIAL_CENTAVOS, chave);

      expect(reavaliado.statusCode).toBe(201);
      expect(dadosDe(reavaliado).lance.seq).toBe(1);
    });

    it('a chave é por licitante: o mesmo UUID de duas contas dá dois lances', async () => {
      const [a, b] = (await apoio.licitantesComSaldo(2)) as [Conta, Conta];
      const [lote1, lote2] = [await apoio.lote(), await apoio.lote()];
      const chave = randomUUID();

      const [da, db] = await Promise.all([
        apoio.lancar(a, lote1, LANCE_INICIAL_CENTAVOS, chave),
        apoio.lancar(b, lote2, LANCE_INICIAL_CENTAVOS, chave),
      ]);

      expect([da.statusCode, db.statusCode]).toEqual([201, 201]);
    });

    it(
      'a repetição conta no limite de tentativas: 1 lance + 10 repetições → uma 429',
      async () => {
        // O 1º lance e as 10 repetições (11 tentativas) cabem numa só janela de 1 s.
        const { preparado, resultado: repetidas } = await rajadaNumaJanela(
          async () => ({ a: await licitante(), loteId: await apoio.lote(), chave: randomUUID() }),
          async ({ a, loteId, chave }) => {
            const primeiro = await apoio.lancar(a, loteId, LANCE_INICIAL_CENTAVOS, chave);
            expect(primeiro.statusCode, primeiro.body).toBe(201);
            return Promise.all(
              Array.from({ length: LIMITE_POR_SEGUNDO }, () =>
                apoio.lancar(a, loteId, LANCE_INICIAL_CENTAVOS, chave),
              ),
            );
          },
        );

        const status = repetidas.map((r) => r.statusCode).sort((x, y) => x - y);
        expect(status).toEqual([...Array.from({ length: LIMITE_POR_SEGUNDO - 1 }, () => 200), 429]);
        expect((await contagemDoLote(pool, preparado.loteId)).lances).toBe(1);
      },
      TIMEOUT_LONGO_MS,
    );
  });

  // --- rate limit ----------------------------------------------------------------------------

  describe('limite de tentativas (RNF-02): 10 lances/s por usuário', () => {
    it(
      '11 lances em 1 s: o 11º → 429 MUITAS_TENTATIVAS com Retry-After: 1; o limite é por usuário',
      async () => {
        const {
          preparado: { b, loteId },
          resultado: respostas,
        } = await rajadaNumaJanela(
          async () => {
            const [conta1, conta2] = (await apoio.licitantesComSaldo(2)) as [Conta, Conta];
            return { a: conta1, b: conta2, loteId: await apoio.lote() };
          },
          ({ a: licitanteDaRajada, loteId: loteDaRajada }) =>
            Promise.all(
              Array.from({ length: LIMITE_POR_SEGUNDO + 1 }, (_, i) =>
                apoio.lancar(
                  licitanteDaRajada,
                  loteDaRajada,
                  LANCE_INICIAL_CENTAVOS + i * INCREMENTO_CENTAVOS,
                ),
              ),
            ),
        );

        const limitadas = respostas.filter((r) => r.statusCode === 429);
        expect(limitadas).toHaveLength(1);
        expect(limitadas[0]?.headers['retry-after']).toBe('1');
        expect(erro(limitadas[0] as LightMyRequestResponse).codigo).toBe('MUITAS_TENTATIVAS');
        // As outras 10 foram avaliadas pelas regras: nenhuma 5xx, e só o primeiro lance de `a` entra.
        for (const r of respostas.filter((x) => x.statusCode !== 429)) {
          expect([201, 422]).toContain(r.statusCode);
        }
        expect(respostas.filter((r) => r.statusCode === 201)).toHaveLength(1);
        // Outro usuário, no mesmo segundo, não é afetado.
        const doOutro = await apoio.lancar(b, loteId, 50_000);
        expect(doOutro.statusCode).toBe(201);
        await apoio.conferirLote(loteId);
      },
      TIMEOUT_LONGO_MS,
    );

    it(
      'passada a janela de 1 s, o mesmo usuário volta a ser avaliado pelas regras',
      async () => {
        const {
          preparado: { a, loteId },
          resultado: rajada,
        } = await rajadaNumaJanela(
          async () => ({ a: await licitante(), loteId: await apoio.lote() }),
          ({ a, loteId }) =>
            Promise.all(
              Array.from({ length: LIMITE_POR_SEGUNDO + 1 }, () =>
                apoio.lancar(a, loteId, LANCE_INICIAL_CENTAVOS),
              ),
            ),
        );
        // Sem isto, a retomada abaixo passaria mesmo se o limite nunca tivesse barrado nada.
        expect(rajada.filter((r) => r.statusCode === 429).length).toBeGreaterThanOrEqual(1);

        await esperar(JANELA_DO_LIMITE_MS + 200);
        const depois = await apoio.lancar(a, loteId, 50_000);

        // `a` lidera o lote: a recusa é a das regras (422), não a do limite (429).
        expect(depois.statusCode).toBe(422);
        expect(erro(depois).codigo).toBe('JA_ESTA_GANHANDO');
      },
      TIMEOUT_LONGO_MS,
    );
  });

  // --- leituras: paginação e privacidade -----------------------------------------------------

  describe('leituras depois de uma disputa real: paginação e privacidade', () => {
    let contas: Conta[];
    let loteId: string;
    let paginas: LanceJson[][];
    const corpos: string[] = [];

    beforeAll(async () => {
      contas = await apoio.licitantesComSaldo(LICITANTES_DA_PAGINACAO);
      loteId = await apoio.lote();
      // Rodízio: nunca o mesmo licitante em seguida (JA_ESTA_GANHANDO) e cada um dá poucos lances,
      // longe do limite de 10/s.
      for (let i = 0; i < LANCES_DA_PAGINACAO; i += 1) {
        const resposta = await apoio.lancar(
          contas[i % LICITANTES_DA_PAGINACAO] as Conta,
          loteId,
          LANCE_INICIAL_CENTAVOS + i * INCREMENTO_CENTAVOS,
        );
        expect(resposta.statusCode, resposta.body).toBe(201);
        corpos.push(resposta.body);
      }
      paginas = [];
      for (const pagina of [1, 2, 3]) {
        const resposta = await obter(`/api/lotes/${loteId}/lances?pagina=${pagina}`);
        expect(resposta.statusCode).toBe(200);
        corpos.push(resposta.body);
        paginas.push(resposta.json<ListaJson<LanceJson>>().dados.slice());
      }
    }, TIMEOUT_LONGO_MS);

    it('a disputa deixa a cadeia íntegra, a seq contígua e o ledger reconciliado', async () => {
      const lances = await apoio.conferirLote(loteId);

      expect(lances).toHaveLength(LANCES_DA_PAGINACAO);
    });

    it('GET /api/lotes/{id}/lances: 50 por página, por seq decrescente, meta com o total real', async () => {
      const [primeira, segunda, terceira] = paginas as [LanceJson[], LanceJson[], LanceJson[]];

      expect(primeira.map((l) => l.seq)).toEqual(
        Array.from({ length: POR_PAGINA_DO_HISTORICO }, (_, i) => LANCES_DA_PAGINACAO - i),
      );
      expect(segunda.map((l) => l.seq)).toEqual([5, 4, 3, 2, 1]);
      expect(terceira).toEqual([]);
      const meta = (await obter(`/api/lotes/${loteId}/lances?pagina=2`)).json<
        ListaJson<LanceJson>
      >().meta;
      expect(meta).toEqual({
        total: LANCES_DA_PAGINACAO,
        pagina: 2,
        limite: POR_PAGINA_DO_HISTORICO,
      });
    });

    it('cada item só tem seq, pseudônimo, valor e instante; o pseudônimo é estável por licitante', () => {
      const todos = paginas.flat();
      for (const lance of todos) {
        expect(Object.keys(lance).sort()).toEqual([
          'criadoEm',
          'pseudonimo',
          'seq',
          'valorCentavos',
        ]);
        expect(lance.pseudonimo).toMatch(PSEUDONIMO);
      }
      const pseudonimoDa = (seq: number): string | undefined =>
        todos.find((l) => l.seq === seq)?.pseudonimo;
      // A conta 0 deu os lances 1, 21 e 41; a conta 1, o lance 2.
      expect(pseudonimoDa(21)).toBe(pseudonimoDa(1));
      expect(pseudonimoDa(41)).toBe(pseudonimoDa(1));
      expect(pseudonimoDa(2)).not.toBe(pseudonimoDa(1));
      expect(new Set(todos.map((l) => l.pseudonimo)).size).toBe(LICITANTES_DA_PAGINACAO);
    });

    it('GET /api/me/lances: um item por lote, com o maior lance e o último instante do usuário', async () => {
      const resposta = await obter('/api/me/lances', contas[0]);
      corpos.push(resposta.body);

      expect(resposta.statusCode).toBe(200);
      const { dados, meta } = resposta.json<ListaJson<ItemDeMeusLances>>();
      expect(meta).toEqual({ total: 1, pagina: 1, limite: 24 });
      const ultimoDaConta = paginas.flat().find((l) => l.seq === 41);
      expect(dados[0]).toMatchObject({
        lote: { id: loteId },
        posicao: 'superado',
        meuMaiorLanceCentavos: LANCE_INICIAL_CENTAVOS + 40 * INCREMENTO_CENTAVOS,
        meuUltimoLanceEm: ultimoDaConta?.criadoEm,
      });
    });

    it('nenhuma resposta (aceite, histórico, meus lances, recusa) traz id, nome ou e-mail de usuário', async () => {
      const recusa = await apoio.lancar(
        contas[LANCES_DA_PAGINACAO % LICITANTES_DA_PAGINACAO] as Conta,
        loteId,
        1,
      );
      expect(recusa.statusCode).toBe(422);
      corpos.push(recusa.body);
      const meusDaUltima = await obter(
        '/api/me/lances',
        contas[(LANCES_DA_PAGINACAO - 1) % LICITANTES_DA_PAGINACAO],
      );
      corpos.push(meusDaUltima.body);

      for (const corpo of corpos) {
        await semDadosDeUsuario(corpo, contas);
      }
      expect(corpos.length).toBeGreaterThan(LANCES_DA_PAGINACAO);
    });
  });
});
