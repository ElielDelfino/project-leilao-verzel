// Integração (Postgres e Redis reais): GET /api/lotes/{id}/lances, GET /api/me/lances e as funções
// públicas da sala (tarefa 080; specs/007 §Interfaces e contratos e §Posição do usuário no lote;
// ADR 0031 D7 e D8). Toda resposta é validada contra o openapi pelo app de teste. O estado é
// semeado com `CadeiaDeLances.anexar` (cadeia real, assinada) e SQL em `lots`, sem passar pela
// carteira: o limite de 10 lances/s por usuário impediria as páginas cheias, e o caminho do POST
// já tem a sua integração (079).
import { randomUUID } from 'node:crypto';

import type { LightMyRequestResponse } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BANCO as TOKEN_DO_BANCO } from '../../../src/config/banco.module.js';
import type { Banco } from '../../../src/db/banco.js';
import { emitirAccessToken } from '../../../src/modules/identidade/tokens.js';
import {
  CadeiaDeLances,
  LeiturasDeLances,
  registrarChaveDeAssinatura,
} from '../../../src/modules/lances/index.js';
import { inserirLote, inserirUsuario, iso } from '../../helpers/lotes-por-sql.js';
import {
  type AppDeIdentidade,
  BANCO,
  CHAVE_JWT,
  criarAppDeIdentidade,
  INFRA_DISPONIVEL,
} from '../identidade/ambiente.js';

const CSRF = 'csrf-de-teste-das-leituras';
const HORA = 60 * 60 * 1000;
const PSEUDONIMO = /^Licitante #[0-9a-f]{6}$/;
const UUID_INEXISTENTE = '0192f000-0000-7000-8000-00000000dead';

interface Conta {
  readonly id: string;
  readonly nome: string;
  readonly email: string;
  readonly cabecalhos: Readonly<Record<string, string>>;
}

interface LanceJson {
  readonly seq: number;
  readonly pseudonimo: string;
  readonly valorCentavos: number;
  readonly criadoEm: string;
}

interface ItemJson {
  readonly lote: Record<string, unknown> & { readonly id: string };
  readonly posicao: string;
  readonly meuMaiorLanceCentavos: number;
  readonly meuUltimoLanceEm: string;
}

interface ListaJson<T> {
  readonly dados: readonly T[];
  readonly meta: { readonly total: number; readonly pagina: number; readonly limite: number };
}

describe.skipIf(!INFRA_DISPONIVEL)('leituras de lances (Postgres e Redis reais)', () => {
  let ctx: AppDeIdentidade;
  let pool: pg.Pool;
  let banco: Banco;
  let cadeia: CadeiaDeLances;
  let leituras: LeiturasDeLances;
  let leiloeiro: Conta;
  /** Relógio dos lances semeados: cresce 1 s por lance, para uma ordem sem empate. */
  let relogio = Date.now() - 3 * HORA;

  beforeAll(async () => {
    ctx = await criarAppDeIdentidade();
    await registrarChaveDeAssinatura(ctx.app);
    pool = new pg.Pool(BANCO.conexao());
    banco = ctx.app.get<Banco>(TOKEN_DO_BANCO);
    cadeia = ctx.app.get(CadeiaDeLances);
    leituras = ctx.app.get(LeiturasDeLances);
    leiloeiro = await conta('leiloeiro');
  });

  afterAll(async () => {
    await pool.end();
    await ctx.fechar();
  });

  async function conta(papel: 'leiloeiro' | 'licitante' = 'licitante'): Promise<Conta> {
    const { id, nome, email } = await inserirUsuario(pool, papel);
    const token = await emitirAccessToken(CHAVE_JWT, { id, papel });
    return {
      id,
      nome,
      email,
      cabecalhos: { cookie: `access_token=${token}; csrf_token=${CSRF}`, 'x-csrf-token': CSRF },
    };
  }

  /** Lote com lance inicial R$ 10,00; padrão ao vivo, começou há 1 h e termina em 1 h. */
  async function lote(extra: Record<string, string | number> = {}): Promise<string> {
    const criado = await inserirLote(pool, leiloeiro.id, {
      lance_inicial_centavos: 1000,
      incremento_minimo_centavos: 100,
      ...extra,
    });
    return criado.id;
  }

  /** Lance na cadeia real mais o estado de `lots` que o POST deixaria (sem a carteira). */
  async function semear(loteId: string, quem: Conta, valorCentavos: number): Promise<void> {
    relogio += 1000;
    await banco.transaction((tx) =>
      cadeia.anexar(tx, {
        loteId,
        licitanteId: quem.id,
        valorCentavos,
        criadoEm: new Date(relogio),
        idempotencyKey: randomUUID(),
      }),
    );
    await pool.query(
      `update lots set lance_atual_centavos = $2, lider_id = $3, total_lances = total_lances + 1
        where id = $1`,
      [loteId, valorCentavos, quem.id],
    );
  }

  /** Fim no passado (o status derivado vira `encerrado`), com o status e o vencedor dados. */
  async function vencer(
    loteId: string,
    gravado: { status: 'ao_vivo' | 'encerrado' | 'cancelado'; vencedorId?: string },
  ): Promise<void> {
    await pool.query(
      `update lots
          set inicio_em = now() - interval '2 hours',
              fim_original_em = now() - interval '1 minute',
              fim_em = now() - interval '1 minute',
              status = $2::status_lote,
              vencedor_id = $3,
              valor_arremate_centavos = case when $3::uuid is null then null
                                             else lance_atual_centavos end
        where id = $1`,
      [loteId, gravado.status, gravado.vencedorId ?? null],
    );
  }

  function obter(url: string, quem?: Conta): Promise<LightMyRequestResponse> {
    return ctx.app.inject({ method: 'GET', url, headers: quem?.cabecalhos ?? {} });
  }

  const historico = (loteId: string, consulta = ''): Promise<LightMyRequestResponse> =>
    obter(`/api/lotes/${loteId}/lances${consulta}`);

  const meusLances = (quem: Conta | undefined, consulta = ''): Promise<LightMyRequestResponse> =>
    obter(`/api/me/lances${consulta}`, quem);

  const json = <T>(resposta: LightMyRequestResponse): T => resposta.json<T>();

  function semDadosDeUsuario(corpo: string, ...contas: readonly Conta[]): void {
    for (const c of contas) {
      expect(corpo).not.toContain(c.id);
      expect(corpo).not.toContain(c.nome);
      expect(corpo).not.toContain(c.email);
    }
    expect(corpo).not.toMatch(/licitante_?id|liderId|vencedorId|"email"|"nome"/i);
  }

  describe('GET /api/lotes/{id}/lances', () => {
    it('é público, por seq decrescente, só com pseudônimo e sem cache', async () => {
      const a = await conta();
      const b = await conta();
      const loteId = await lote();
      await semear(loteId, a, 1000);
      await semear(loteId, b, 1100);
      await semear(loteId, a, 1200);

      const resposta = await historico(loteId);

      expect(resposta.statusCode).toBe(200);
      expect(resposta.headers['cache-control']).toBe('no-store');
      const { dados, meta } = json<ListaJson<LanceJson>>(resposta);
      expect(dados.map((l) => [l.seq, l.valorCentavos])).toEqual([
        [3, 1200],
        [2, 1100],
        [1, 1000],
      ]);
      expect(meta).toEqual({ total: 3, pagina: 1, limite: 50 });
      for (const lance of dados) {
        expect(Object.keys(lance).sort()).toEqual([
          'criadoEm',
          'pseudonimo',
          'seq',
          'valorCentavos',
        ]);
        expect(lance.pseudonimo).toMatch(PSEUDONIMO);
      }
      expect(dados[0]?.pseudonimo).toBe(leituras.seuPseudonimo(loteId, a.id));
      expect(dados[1]?.pseudonimo).toBe(leituras.seuPseudonimo(loteId, b.id));
      semDadosDeUsuario(resposta.body, a, b, leiloeiro);
    });

    it('lote sem lance: 200 com lista vazia e total 0', async () => {
      const resposta = await historico(await lote());

      expect(resposta.statusCode).toBe(200);
      expect(json<ListaJson<LanceJson>>(resposta)).toMatchObject({
        dados: [],
        meta: { total: 0, pagina: 1, limite: 50 },
      });
    });

    it('pagina de 50 em 50; além da última, lista vazia com o total real', async () => {
      const a = await conta();
      const loteId = await lote();
      for (let i = 0; i < 55; i += 1) await semear(loteId, a, 1000 + i * 100);

      const primeira = json<ListaJson<LanceJson>>(await historico(loteId));
      const segunda = json<ListaJson<LanceJson>>(await historico(loteId, '?pagina=2'));
      const terceira = json<ListaJson<LanceJson>>(await historico(loteId, '?pagina=3'));
      const ultima = json<ListaJson<LanceJson>>(await historico(loteId, '?pagina=500'));

      expect(primeira.dados).toHaveLength(50);
      expect(primeira.dados[0]?.seq).toBe(55);
      expect(primeira.dados[49]?.seq).toBe(6);
      expect(primeira.meta).toEqual({ total: 55, pagina: 1, limite: 50 });
      expect(segunda.dados.map((l) => l.seq)).toEqual([5, 4, 3, 2, 1]);
      expect(segunda.meta).toEqual({ total: 55, pagina: 2, limite: 50 });
      expect(terceira.dados).toEqual([]);
      expect(terceira.meta).toEqual({ total: 55, pagina: 3, limite: 50 });
      expect(ultima.dados).toEqual([]);
      expect(ultima.meta).toEqual({ total: 55, pagina: 500, limite: 50 });
    });

    it.each(['0', '501', '-1', '01', '1.5', 'abc', '', '1e2'])(
      '`pagina=%s` → 422 DADOS_INVALIDOS com detalhes.campo pagina',
      async (pagina) => {
        const resposta = await historico(await lote(), `?pagina=${pagina}`);

        expect(resposta.statusCode).toBe(422);
        expect(json<{ erro: unknown }>(resposta).erro).toMatchObject({
          codigo: 'DADOS_INVALIDOS',
          detalhes: { campo: 'pagina' },
        });
      },
    );

    it('`pagina` repetida → 422', async () => {
      const resposta = await historico(await lote(), '?pagina=1&pagina=2');

      expect(resposta.statusCode).toBe(422);
    });

    it('lote inexistente ou id que não é UUID → 404 NAO_ENCONTRADO', async () => {
      for (const id of [UUID_INEXISTENTE, 'nao-e-uuid']) {
        const resposta = await historico(id);

        expect(resposta.statusCode).toBe(404);
        expect(json<{ erro: unknown }>(resposta).erro).toMatchObject({ codigo: 'NAO_ENCONTRADO' });
      }
    });
  });

  describe('posição do usuário e GET /api/me/lances', () => {
    type Nome =
      | 'ganhando'
      | 'superado'
      | 'venceu'
      | 'perdeu'
      | 'cancelado'
      | 'vencidoLider'
      | 'vencidoSuperado';

    let eu: Conta;
    let outro: Conta;
    /** Lotes do cenário, na ordem em que receberam o último lance de `eu` (do mais antigo). */
    const lotes = {} as Record<Nome | 'semLance' | 'agendado', string>;
    const ordemDeCriacao: Nome[] = [];

    beforeAll(async () => {
      eu = await conta();
      outro = await conta();
      const novo = async (nome: Nome): Promise<string> => {
        lotes[nome] = await lote();
        ordemDeCriacao.push(nome);
        return lotes[nome];
      };

      let id = await novo('ganhando');
      await semear(id, eu, 1000);
      await semear(id, outro, 1100);
      await semear(id, eu, 1200);

      id = await novo('superado');
      await semear(id, eu, 1000);
      await semear(id, outro, 1100);

      id = await novo('venceu');
      await semear(id, eu, 1000);
      await vencer(id, { status: 'encerrado', vencedorId: eu.id });

      id = await novo('perdeu');
      await semear(id, eu, 1000);
      await semear(id, outro, 1100);
      await vencer(id, { status: 'encerrado', vencedorId: outro.id });

      id = await novo('cancelado');
      await semear(id, eu, 1000);
      await vencer(id, { status: 'cancelado' });

      // Fim vencido e vencedor ainda não gravado pelo job de encerramento (specs/007).
      id = await novo('vencidoLider');
      await semear(id, eu, 1000);
      await vencer(id, { status: 'ao_vivo' });

      id = await novo('vencidoSuperado');
      await semear(id, eu, 1000);
      await semear(id, outro, 1100);
      await vencer(id, { status: 'ao_vivo' });

      // Sem lance de `eu`: ao vivo com lance só do outro, e agendado.
      lotes.semLance = await lote();
      await semear(lotes.semLance, outro, 1000);
      lotes.agendado = await lote({
        inicio_em: iso(Date.now() + HORA),
        fim_em: iso(Date.now() + 2 * HORA),
        status: 'agendado',
      });
    });

    const ESPERADA: Readonly<Record<Nome, string>> = {
      ganhando: 'ganhando',
      superado: 'superado',
      venceu: 'venceu',
      perdeu: 'perdeu',
      cancelado: 'perdeu',
      vencidoLider: 'ganhando',
      vencidoSuperado: 'perdeu',
    };

    /** Status derivado esperado do lote (o de `vencidoLider` e `vencidoSuperado` vem do `fim_em`). */
    const STATUS_DO_LOTE: Readonly<Record<Nome, string>> = {
      ganhando: 'ao_vivo',
      superado: 'ao_vivo',
      venceu: 'encerrado',
      perdeu: 'encerrado',
      cancelado: 'cancelado',
      vencidoLider: 'encerrado',
      vencidoSuperado: 'encerrado',
    };

    describe('posicaoDoUsuario(loteId, userId)', () => {
      it.each(Object.entries(ESPERADA) as [Nome, string][])(
        'lote %s → %s',
        async (nome, esperada) => {
          expect(await leituras.posicaoDoUsuario(lotes[nome], eu.id)).toBe(esperada);
        },
      );

      it('sem lance do usuário (ao vivo, agendado, inexistente, id inválido) → sem_lance', async () => {
        for (const id of [lotes.semLance, lotes.agendado, UUID_INEXISTENTE, 'nao-e-uuid']) {
          expect(await leituras.posicaoDoUsuario(id, eu.id)).toBe('sem_lance');
        }
      });

      it('a posição é por usuário: o outro lidera onde `eu` foi superado', async () => {
        expect(await leituras.posicaoDoUsuario(lotes.superado, outro.id)).toBe('ganhando');
        expect(await leituras.posicaoDoUsuario(lotes.perdeu, outro.id)).toBe('venceu');
        expect(await leituras.posicaoDoUsuario(lotes.vencidoSuperado, outro.id)).toBe('ganhando');
      });
    });

    describe('GET /api/me/lances', () => {
      it('um item por lote com lance, com a posição, os agregados e o resumo do lote', async () => {
        const resposta = await meusLances(eu);

        expect(resposta.statusCode).toBe(200);
        expect(resposta.headers['cache-control']).toBe('no-store');
        const { dados, meta } = json<ListaJson<ItemJson>>(resposta);
        expect(meta).toEqual({ total: 7, pagina: 1, limite: 24 });
        // Do último lance mais recente ao mais antigo: o inverso da criação do cenário.
        expect(dados.map((i) => i.lote.id)).toEqual(
          [...ordemDeCriacao].reverse().map((nome) => lotes[nome]),
        );
        for (const item of dados) {
          const nome = ordemDeCriacao.find((n) => lotes[n] === item.lote.id);
          expect(nome).toBeDefined();
          expect(item.posicao).toBe(ESPERADA[nome as Nome]);
          expect(item.lote['status']).toBe(STATUS_DO_LOTE[nome as Nome]);
        }
        const doLote = (nome: Nome): ItemJson => {
          const item = dados.find((i) => i.lote.id === lotes[nome]);
          if (item === undefined) throw new Error(`lote ${nome} fora da lista`);
          return item;
        };
        expect(doLote('ganhando').meuMaiorLanceCentavos).toBe(1200);
        expect(doLote('superado').meuMaiorLanceCentavos).toBe(1000);
        expect(doLote('ganhando').lote).toMatchObject({
          lanceAtualCentavos: 1200,
          precoAtualCentavos: 1200,
          totalLances: 3,
        });
        // O último lance de `eu` em "ganhando" (cenário criado primeiro) é anterior ao de "superado".
        expect(Date.parse(doLote('ganhando').meuUltimoLanceEm)).toBeLessThan(
          Date.parse(doLote('superado').meuUltimoLanceEm),
        );
      });

      it('não lista lote sem lance do usuário nem agendado', async () => {
        const { dados } = json<ListaJson<ItemJson>>(await meusLances(eu));

        const ids = dados.map((i) => i.lote.id);
        expect(ids).not.toContain(lotes.semLance);
        expect(ids).not.toContain(lotes.agendado);
      });

      it('só devolve lances do próprio usuário e nenhum dado de usuário', async () => {
        const resposta = await meusLances(outro);

        const { dados, meta } = json<ListaJson<ItemJson>>(resposta);
        const ids = dados.map((i) => i.lote.id);
        expect(ids).toContain(lotes.semLance);
        expect(ids).toContain(lotes.superado);
        expect(ids).not.toContain(lotes.venceu); // `eu` venceu sozinho; `outro` não deu lance
        expect(meta.total).toBe(dados.length);
        semDadosDeUsuario(resposta.body, eu, outro, leiloeiro);
        const respostaDeEu = await meusLances(eu);
        semDadosDeUsuario(respostaDeEu.body, eu, outro, leiloeiro);
      });

      it('usuário sem lance: 200 com lista vazia', async () => {
        const resposta = await meusLances(await conta());

        expect(resposta.statusCode).toBe(200);
        expect(json<ListaJson<ItemJson>>(resposta)).toMatchObject({
          dados: [],
          meta: { total: 0, pagina: 1, limite: 24 },
        });
      });

      it('sem sessão → 401 NAO_AUTENTICADO', async () => {
        const resposta = await meusLances(undefined);

        expect(resposta.statusCode).toBe(401);
        expect(json<{ erro: unknown }>(resposta).erro).toMatchObject({
          codigo: 'NAO_AUTENTICADO',
        });
      });

      it('leiloeiro → 403 PAPEL_NAO_PERMITIDO', async () => {
        const resposta = await meusLances(leiloeiro);

        expect(resposta.statusCode).toBe(403);
        expect(json<{ erro: unknown }>(resposta).erro).toMatchObject({
          codigo: 'PAPEL_NAO_PERMITIDO',
        });
      });

      it.each(['0', '501', '01', 'abc', ''])(
        '`pagina=%s` → 422 DADOS_INVALIDOS com detalhes.campo pagina',
        async (pagina) => {
          const resposta = await meusLances(eu, `?pagina=${pagina}`);

          expect(resposta.statusCode).toBe(422);
          expect(json<{ erro: unknown }>(resposta).erro).toMatchObject({
            codigo: 'DADOS_INVALIDOS',
            detalhes: { campo: 'pagina' },
          });
        },
      );
    });
  });

  describe('GET /api/me/lances: paginação', () => {
    it('24 por página; além da última, lista vazia com o total real', async () => {
      const p = await conta();
      const ids: string[] = [];
      for (let i = 0; i < 25; i += 1) {
        const id = await lote();
        await semear(id, p, 1000);
        ids.push(id);
      }

      const primeira = json<ListaJson<ItemJson>>(await meusLances(p));
      const segunda = json<ListaJson<ItemJson>>(await meusLances(p, '?pagina=2'));
      const terceira = json<ListaJson<ItemJson>>(await meusLances(p, '?pagina=3'));

      expect(primeira.dados).toHaveLength(24);
      expect(primeira.meta).toEqual({ total: 25, pagina: 1, limite: 24 });
      expect(segunda.dados).toHaveLength(1);
      expect(segunda.meta).toEqual({ total: 25, pagina: 2, limite: 24 });
      expect(terceira.dados).toEqual([]);
      expect(terceira.meta).toEqual({ total: 25, pagina: 3, limite: 24 });
      // Mais recente primeiro; o mais antigo (primeiro lote) fecha a página 2.
      expect([...primeira.dados, ...segunda.dados].map((i) => i.lote.id)).toEqual(
        [...ids].reverse(),
      );
    });
  });

  describe('ultimosLances(loteId, n) e seuPseudonimo(loteId, userId)', () => {
    it('ultimosLances devolve os n mais recentes, por seq decrescente, sem dado de usuário', async () => {
      const a = await conta();
      const loteId = await lote();
      for (const valor of [1000, 1100, 1200]) await semear(loteId, a, valor);

      const ultimos = await leituras.ultimosLances(loteId, 2);

      expect(ultimos.map((l) => [l.seq, l.valorCentavos])).toEqual([
        [3, 1200],
        [2, 1100],
      ]);
      for (const lance of ultimos) {
        expect(Object.keys(lance).sort()).toEqual([
          'criadoEm',
          'pseudonimo',
          'seq',
          'valorCentavos',
        ]);
      }
      expect(await leituras.ultimosLances(loteId, 50)).toHaveLength(3);
    });

    it('ultimosLances: lote sem lance, inexistente ou id inválido → lista vazia', async () => {
      expect(await leituras.ultimosLances(await lote(), 50)).toEqual([]);
      expect(await leituras.ultimosLances(UUID_INEXISTENTE, 50)).toEqual([]);
      expect(await leituras.ultimosLances('nao-e-uuid', 50)).toEqual([]);
    });

    it.each([0, -1, 51, 1.5, Number.NaN])(
      'ultimosLances recusa n = %s com RangeError',
      async (n) => {
        await expect(leituras.ultimosLances(UUID_INEXISTENTE, n)).rejects.toBeInstanceOf(
          RangeError,
        );
      },
    );

    it('seuPseudonimo é o gravado nos lances, estável no lote e diferente entre lotes', async () => {
      const a = await conta();
      const primeiro = await lote();
      const segundo = await lote();
      await semear(primeiro, a, 1000);

      const [gravado] = await leituras.ultimosLances(primeiro, 1);

      expect(leituras.seuPseudonimo(primeiro, a.id)).toBe(gravado?.pseudonimo);
      expect(leituras.seuPseudonimo(primeiro, a.id)).toBe(leituras.seuPseudonimo(primeiro, a.id));
      expect(leituras.seuPseudonimo(segundo, a.id)).toMatch(PSEUDONIMO);
      expect(leituras.seuPseudonimo(segundo, a.id)).not.toBe(
        leituras.seuPseudonimo(primeiro, a.id),
      );
    });

    it('seuPseudonimo sem lance no lote e com id em maiúsculas', async () => {
      const a = await conta();
      const loteId = await lote();

      const pseudonimo = leituras.seuPseudonimo(loteId, a.id);

      expect(pseudonimo).toMatch(PSEUDONIMO);
      expect(leituras.seuPseudonimo(loteId.toUpperCase(), a.id)).toBe(pseudonimo);
    });
  });
});
