// Integração (Postgres e Redis reais, Scryfall falsa): vitrine e detalhe público do lote
// (specs/006 §Vitrine e §Detalhe; tarefa 057). Toda resposta HTTP é validada contra o
// openapi.yaml pelo app de teste. O banco é compartilhado com arquivos paralelos: cada teste
// escopa a vitrine com um `q` único gravado no título dos seus lotes.
import { randomBytes, randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { LightMyRequestResponse } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { emitirAccessToken } from '../../../src/modules/identidade/tokens.js';
import { apagarChavesDoPrefixo, clienteDeTeste } from '../../common/limite/redis-de-teste.js';
import {
  apagarChavesDaScryfall,
  criarAppDeTeste,
  novoPrefixoDaScryfall,
} from '../../helpers/app-de-teste.js';
import { iniciarScryfallFalsa, type ScryfallFalsa } from '../../helpers/scryfall-falsa.js';
import {
  BANCO,
  CHAVE_JWT,
  emailNovo,
  envReal,
  INFRA_DISPONIVEL,
  REDIS,
} from '../identidade/ambiente.js';

type Papel = 'leiloeiro' | 'licitante';
type Cabecalhos = Readonly<Record<string, string>>;
type Valor = string | number | null;

interface Conta {
  readonly id: string;
  readonly nome: string;
  readonly email: string;
  readonly cabecalhos: Cabecalhos;
}

interface LoteDaResposta {
  readonly id: string;
  readonly status: string;
  readonly precoAtualCentavos: number;
}

interface Pagina {
  readonly dados: LoteDaResposta[];
  readonly meta: { total: number; pagina: number; limite: number };
}

const CSRF = 'csrf-de-teste-da-vitrine';
const MINUTO = 60 * 1000;
const HORA = 60 * MINUTO;
const ID_INEXISTENTE = '99999999-9999-4999-8999-999999999999';
const SEM_CACHE = 'private, no-store';
const NOME_DO_SNAPSHOT = 'Carta do Snapshot';

const iso = (ms: number): string => new Date(ms).toISOString();
const novaTag = (): string => `zv${randomBytes(6).toString('hex')}`;

describe.skipIf(!INFRA_DISPONIVEL)('lotes: vitrine e detalhe com Postgres e Scryfall falsa', () => {
  let app: NestFastifyApplication;
  let scryfall: ScryfallFalsa;
  let pool: pg.Pool;
  let redis: Awaited<ReturnType<typeof clienteDeTeste>>;
  let leiloeiro: Conta;
  const prefixoDoLimite = `ratelimit:teste-${randomUUID()}:`;
  const prefixoDaScryfall = novoPrefixoDaScryfall();
  const usuarios: string[] = [];

  beforeAll(async () => {
    scryfall = await iniciarScryfallFalsa();
    const base = envReal();
    app = await criarAppDeTeste({
      env: { ...base, scryfall: { ...base.scryfall, baseUrl: scryfall.url } },
      clientesReais: true,
      prefixoDoLimite,
      prefixoDaScryfall,
    });
    pool = new pg.Pool(BANCO.conexao());
    redis = await clienteDeTeste(REDIS.conexao());
    leiloeiro = await conta('leiloeiro');
  });

  beforeEach(async () => {
    scryfall.definirModo('ok');
    scryfall.zerar();
    await apagarChavesDaScryfall(redis, prefixoDaScryfall);
  });

  afterAll(async () => {
    const { rows } = await pool.query<{ snapshot_id: string }>(
      'delete from lots where leiloeiro_id = any($1::uuid[]) returning snapshot_id',
      [usuarios],
    );
    await pool.query('delete from card_snapshots where id = any($1::uuid[])', [
      rows.map((r) => r.snapshot_id),
    ]);
    await pool.query('delete from users where id = any($1::uuid[])', [usuarios]);
    await pool.end();
    await apagarChavesDaScryfall(redis, prefixoDaScryfall);
    await apagarChavesDoPrefixo(redis, prefixoDoLimite);
    redis.destroy();
    await app.close();
    await scryfall.fechar();
  });

  async function conta(papel: Papel): Promise<Conta> {
    const nome = `Pessoa Secreta ${randomUUID().slice(0, 8)}`;
    const email = emailNovo();
    const { rows } = await pool.query<{ id: string }>(
      `insert into users (nome, email, senha_hash, papel) values ($1, $2, $3, $4) returning id`,
      [nome, email, 'hash-que-nao-e-usado', papel],
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('insert em users não devolveu o id');
    usuarios.push(id);
    const token = await emitirAccessToken(CHAVE_JWT, { id, papel });
    return {
      id,
      nome,
      email,
      cabecalhos: { cookie: `access_token=${token}; csrf_token=${CSRF}`, 'x-csrf-token': CSRF },
    };
  }

  /** Snapshot mínimo e lote gravados por SQL; padrão: ao vivo, R$ 1,00, common. */
  async function lote(extra: Readonly<Record<string, Valor>> = {}): Promise<string> {
    const { rows: snap } = await pool.query<{ id: string }>(
      `insert into card_snapshots
         (scryfall_id, nome, colecao, raridade, tipo, texto_oracle, artista, dados, imagem,
          imagem_mime, imagem_sha256)
       values ($1, $2, 'Coleção', 'common', 'Instant', 'Causa 3 de dano.', null, '{}'::jsonb,
               '\\x00'::bytea, 'image/png', decode(repeat('00', 32), 'hex'))
       returning id`,
      [randomUUID(), NOME_DO_SNAPSHOT],
    );
    const agora = Date.now();
    const fim = typeof extra['fim_em'] === 'string' ? extra['fim_em'] : iso(agora + HORA);
    const colunas: Record<string, Valor> = {
      leiloeiro_id: leiloeiro.id,
      snapshot_id: snap[0]?.id ?? null,
      carta_nome: 'Carta Comum',
      raridade: 'common',
      titulo: 'Lote da vitrine',
      lance_inicial_centavos: 100,
      incremento_minimo_centavos: 100,
      inicio_em: iso(agora - HORA),
      fim_em: fim,
      fim_original_em: fim,
      status: 'ao_vivo',
      ...extra,
    };
    const nomes = Object.keys(colunas);
    const { rows } = await pool.query<{ id: string }>(
      `insert into lots (${nomes.join(', ')})
       values (${nomes.map((_, i) => `$${i + 1}`).join(', ')}) returning id`,
      Object.values(colunas),
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('insert em lots não devolveu o id');
    return id;
  }

  function get(url: string, headers: Cabecalhos = {}): Promise<LightMyRequestResponse> {
    return app.inject({ method: 'GET', url, headers });
  }

  async function vitrine(parametros: Readonly<Record<string, string>>): Promise<Pagina> {
    const resposta = await get(`/api/lotes?${new URLSearchParams(parametros).toString()}`);
    expect(resposta.statusCode, resposta.body).toBe(200);
    return resposta.json<Pagina>();
  }

  async function ids(parametros: Readonly<Record<string, string>>): Promise<string[]> {
    return (await vitrine(parametros)).dados.map((l) => l.id);
  }

  /** Ordem do desempate (id decrescente; hex minúsculo compara como os bytes do uuid). */
  const porIdDecrescente = (lista: readonly string[]): string[] =>
    [...lista].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));

  describe('GET /api/lotes', () => {
    it('deriva o status dos horários e nunca lista cancelados', async () => {
      const tag = novaTag();
      const agora = Date.now();
      const titulo = `${tag} lote`;
      const agendado = await lote({
        titulo,
        status: 'agendado',
        inicio_em: iso(agora + HORA),
        fim_em: iso(agora + 2 * HORA),
      });
      const agendadoQueJaAbriu = await lote({ titulo, status: 'agendado' });
      const aoVivo = await lote({ titulo });
      const vencidoAindaAoVivo = await lote({
        titulo,
        inicio_em: iso(agora - 2 * HORA),
        fim_em: iso(agora - HORA),
      });
      const encerrado = await lote({
        titulo,
        status: 'encerrado',
        inicio_em: iso(agora - 2 * HORA),
        fim_em: iso(agora - HORA),
      });
      await lote({ titulo, status: 'cancelado' });

      expect(new Set(await ids({ q: tag, status: 'agendado' }))).toEqual(new Set([agendado]));
      expect(new Set(await ids({ q: tag, status: 'ao_vivo' }))).toEqual(
        new Set([agendadoQueJaAbriu, aoVivo]),
      );
      expect(new Set(await ids({ q: tag, status: 'encerrado' }))).toEqual(
        new Set([vencidoAindaAoVivo, encerrado]),
      );
      const todos = await vitrine({ q: tag });
      expect(new Set(todos.dados.map((l) => l.id))).toEqual(
        new Set([agendado, agendadoQueJaAbriu, aoVivo, vencidoAindaAoVivo, encerrado]),
      );
      expect(todos.meta).toEqual({ total: 5, pagina: 1, limite: 24 });
      const statusDe = new Map(todos.dados.map((l) => [l.id, l.status]));
      expect(statusDe.get(vencidoAindaAoVivo)).toBe('encerrado');
      expect(statusDe.get(agendadoQueJaAbriu)).toBe('ao_vivo');
    });

    it('q busca no título e no nome da carta, com % e _ literais e sem caixa', async () => {
      const tag = novaTag();
      const noTitulo = await lote({ titulo: `Título ${tag.toUpperCase()}` });
      const naCarta = await lote({ carta_nome: `Carta ${tag}` });
      const literal = await lote({ titulo: `${tag}%_x` });
      const semCuringa = await lote({ titulo: `${tag}ab x` });

      expect(new Set(await ids({ q: tag }))).toEqual(
        new Set([noTitulo, naCarta, literal, semCuringa]),
      );
      expect(await ids({ q: `${tag}%_` })).toEqual([literal]);
      expect(await ids({ q: `  ${tag}%_  ` })).toEqual([literal]);
    });

    it('faixa de preço fechada sobre coalesce(lance atual, lance inicial)', async () => {
      const tag = novaTag();
      const semLance = await lote({ titulo: tag, lance_inicial_centavos: 1000 });
      const comLance = await lote({
        titulo: tag,
        lance_inicial_centavos: 500,
        lance_atual_centavos: 2000,
        total_lances: 1,
      });
      await lote({ titulo: tag, lance_inicial_centavos: 3000 });
      await lote({ titulo: tag, lance_inicial_centavos: 999 });
      await lote({
        titulo: tag,
        lance_inicial_centavos: 1500,
        lance_atual_centavos: 2001,
        total_lances: 1,
      });

      expect(new Set(await ids({ q: tag, precoMin: '1000', precoMax: '2000' }))).toEqual(
        new Set([semLance, comLance]),
      );
      const acima = await vitrine({ q: tag, precoMin: '2000' });
      expect(acima.meta.total).toBe(3);
    });

    it('filtra por raridade', async () => {
      const tag = novaTag();
      const mitica = await lote({ titulo: tag, raridade: 'mythic' });
      await lote({ titulo: tag, raridade: 'rare' });
      expect(await ids({ q: tag, raridade: 'mythic' })).toEqual([mitica]);
    });

    it('as três ordens, com desempate por id decrescente', async () => {
      const tag = novaTag();
      const agora = Date.now();
      const fimCedo = iso(agora + HORA);
      const fimTarde = iso(agora + 2 * HORA);
      const criadoAntes = iso(agora - 10 * MINUTO);
      const criadoDepois = iso(agora - 5 * MINUTO);
      const a = await lote({
        titulo: tag,
        fim_em: fimTarde,
        criado_em: criadoAntes,
        lance_inicial_centavos: 500,
      });
      const b = await lote({
        titulo: tag,
        fim_em: fimCedo,
        criado_em: criadoDepois,
        lance_inicial_centavos: 100,
        lance_atual_centavos: 500,
        total_lances: 1,
      });
      const c = await lote({
        titulo: tag,
        fim_em: fimCedo,
        criado_em: criadoAntes,
        lance_inicial_centavos: 900,
      });

      expect(await ids({ q: tag })).toEqual([...porIdDecrescente([b, c]), a]);
      expect(await ids({ q: tag, ordem: 'termina_antes' })).toEqual([
        ...porIdDecrescente([b, c]),
        a,
      ]);
      expect(await ids({ q: tag, ordem: 'mais_recente' })).toEqual([
        b,
        ...porIdDecrescente([a, c]),
      ]);
      expect(await ids({ q: tag, ordem: 'maior_lance' })).toEqual([c, ...porIdDecrescente([a, b])]);
    });

    it('filtros combinados retornam o conjunto exato', async () => {
      const tag = novaTag();
      const agora = Date.now();
      const alvoCaro = await lote({
        titulo: `${tag} alvo`,
        raridade: 'rare',
        lance_inicial_centavos: 4000,
      });
      const alvoBarato = await lote({
        titulo: `${tag} alvo`,
        raridade: 'rare',
        lance_inicial_centavos: 1000,
        lance_atual_centavos: 3000,
        total_lances: 2,
      });
      // Cada um falha em exatamente um filtro.
      await lote({ titulo: `${tag} alvo`, raridade: 'common', lance_inicial_centavos: 4000 });
      await lote({ titulo: `${tag} alvo`, raridade: 'rare', lance_inicial_centavos: 9000 });
      await lote({ titulo: `${tag} fora`, raridade: 'rare', lance_inicial_centavos: 4000 });
      await lote({
        titulo: `${tag} alvo`,
        raridade: 'rare',
        lance_inicial_centavos: 4000,
        status: 'agendado',
        inicio_em: iso(agora + HORA),
        fim_em: iso(agora + 2 * HORA),
      });
      await lote({
        titulo: `${tag} alvo`,
        raridade: 'rare',
        lance_inicial_centavos: 4000,
        status: 'cancelado',
      });

      const pagina = await vitrine({
        status: 'ao_vivo',
        q: `${tag} alvo`,
        precoMin: '2500',
        precoMax: '5000',
        raridade: 'rare',
        ordem: 'maior_lance',
      });
      expect(pagina.dados.map((l) => l.id)).toEqual([alvoCaro, alvoBarato]);
      expect(pagina.dados.map((l) => l.precoAtualCentavos)).toEqual([4000, 3000]);
      expect(pagina.meta.total).toBe(2);
    });

    it('24 por página, sem repetição nem lacuna com valores empatados', async () => {
      const tag = novaTag();
      const fim = iso(Date.now() + HORA);
      const criados: string[] = [];
      for (let i = 0; i < 25; i += 1) {
        criados.push(await lote({ titulo: tag, fim_em: fim }));
      }
      const primeira = await vitrine({ q: tag });
      const segunda = await vitrine({ q: tag, pagina: '2' });
      const terceira = await vitrine({ q: tag, pagina: '3' });

      expect(primeira.dados).toHaveLength(24);
      expect(primeira.meta).toEqual({ total: 25, pagina: 1, limite: 24 });
      expect(segunda.dados).toHaveLength(1);
      expect([...primeira.dados, ...segunda.dados].map((l) => l.id)).toEqual(
        porIdDecrescente(criados),
      );
      expect(terceira.dados).toEqual([]);
      expect(terceira.meta).toEqual({ total: 25, pagina: 3, limite: 24 });
    });

    it.each([
      ['pagina=501', 'pagina'],
      ['q=', 'q'],
      [`q=${'a'.repeat(101)}`, 'q'],
      ['precoMin=10&precoMax=9', 'precoMax'],
      ['status=cancelado', 'status'],
      ['status=desconhecido', 'status'],
      ['raridade=x', 'raridade'],
      ['ordem=x', 'ordem'],
      ['pagina=1&pagina=2', 'pagina'],
      ['outro=1', 'outro'],
    ])('?%s → 422 com detalhes.campo %s', async (consulta, campo) => {
      const resposta = await get(`/api/lotes?${consulta}`);
      expect(resposta.statusCode).toBe(422);
      expect(resposta.json()).toMatchObject({
        sucesso: false,
        erro: { codigo: 'DADOS_INVALIDOS', detalhes: { campo } },
      });
    });
  });

  describe('GET /api/lotes/{id}', () => {
    it('anônimo: 200 com a carta do snapshot, imagemUrl, suaPosicao null e sem cache', async () => {
      const tag = novaTag();
      const id = await lote({ titulo: tag, descricao: 'Bem conservada' });
      const resposta = await get(`/api/lotes/${id}`);

      expect(resposta.statusCode, resposta.body).toBe(200);
      expect(resposta.headers['cache-control']).toBe(SEM_CACHE);
      const { rows } = await pool.query<{ snapshot_id: string }>(
        'select snapshot_id from lots where id = $1',
        [id],
      );
      expect(resposta.json()).toMatchObject({
        sucesso: true,
        dados: {
          id,
          titulo: tag,
          descricao: 'Bem conservada',
          status: 'ao_vivo',
          carta: { nome: NOME_DO_SNAPSHOT, textoOracle: 'Causa 3 de dano.', artista: null },
          imagemUrl: `/api/imagens/${rows[0]?.snapshot_id}`,
          suaPosicao: null,
        },
      });
    });

    it.each([ID_INEXISTENTE, 'nao-e-uuid'])('%s → 404 NAO_ENCONTRADO sem cache', async (id) => {
      const resposta = await get(`/api/lotes/${id}`);
      expect(resposta.statusCode).toBe(404);
      expect(resposta.headers['cache-control']).toBe(SEM_CACHE);
      expect(resposta.json()).toMatchObject({ erro: { codigo: 'NAO_ENCONTRADO' } });
    });

    it('cancelado: fora da vitrine, 200 no detalhe e presente no painel do dono', async () => {
      const dono = await conta('leiloeiro');
      const tag = novaTag();
      const id = await lote({ titulo: tag, status: 'cancelado', leiloeiro_id: dono.id });

      expect(await ids({ q: tag })).toEqual([]);
      const detalhe = await get(`/api/lotes/${id}`);
      expect(detalhe.statusCode).toBe(200);
      expect(detalhe.json()).toMatchObject({ dados: { id, status: 'cancelado' } });
      const painel = await get('/api/painel/lotes', dono.cabecalhos);
      expect(painel.statusCode).toBe(200);
      expect(painel.json<Pagina>().dados.map((l) => [l.id, l.status])).toEqual([[id, 'cancelado']]);
    });

    it('suaPosicao: ganhando, venceu, null para os demais e para anônimo', async () => {
      const lider = await conta('licitante');
      const vencedor = await conta('licitante');
      const outro = await conta('licitante');
      const agora = Date.now();
      const aoVivo = await lote({
        lider_id: lider.id,
        lance_atual_centavos: 500,
        total_lances: 1,
      });
      const encerrado = await lote({
        status: 'encerrado',
        inicio_em: iso(agora - 2 * HORA),
        fim_em: iso(agora - HORA),
        lider_id: vencedor.id,
        vencedor_id: vencedor.id,
        lance_atual_centavos: 700,
        valor_arremate_centavos: 700,
        total_lances: 1,
      });
      // Líder de um lote já vencido pelo horário (o job ainda não encerrou): não está "ganhando".
      const vencidoSemJob = await lote({
        inicio_em: iso(agora - 2 * HORA),
        fim_em: iso(agora - HORA),
        lider_id: lider.id,
        lance_atual_centavos: 500,
        total_lances: 1,
      });

      const posicao = async (id: string, quem?: Conta): Promise<unknown> => {
        const resposta = await get(`/api/lotes/${id}`, quem?.cabecalhos ?? {});
        expect(resposta.statusCode, resposta.body).toBe(200);
        const texto = resposta.body;
        for (const pessoa of [lider, vencedor, outro, leiloeiro]) {
          expect(texto).not.toContain(pessoa.nome);
          expect(texto).not.toContain(pessoa.email);
          expect(texto).not.toContain(pessoa.id);
        }
        return resposta.json<{ dados: { suaPosicao: unknown } }>().dados.suaPosicao;
      };

      expect(await posicao(aoVivo, lider)).toBe('ganhando');
      expect(await posicao(encerrado, vencedor)).toBe('venceu');
      expect(await posicao(aoVivo, outro)).toBeNull();
      expect(await posicao(encerrado, lider)).toBeNull();
      expect(await posicao(vencidoSemJob, lider)).toBeNull();
      expect(await posicao(aoVivo)).toBeNull();
      expect(await posicao(encerrado)).toBeNull();
    });

    it('cookie de acesso inválido → 200 como anônimo', async () => {
      const lider = await conta('licitante');
      const id = await lote({ lider_id: lider.id, lance_atual_centavos: 500, total_lances: 1 });
      const resposta = await get(`/api/lotes/${id}`, {
        cookie: `access_token=invalido; csrf_token=${CSRF}`,
      });
      expect(resposta.statusCode).toBe(200);
      expect(resposta.json()).toMatchObject({ dados: { suaPosicao: null } });
    });
  });

  it('com a Scryfall bloqueada, vitrine e detalhe respondem 200 sem chamá-la', async () => {
    const tag = novaTag();
    const id = await lote({ titulo: tag });
    scryfall.definirModo('bloqueada');
    scryfall.zerar();

    expect(await ids({ q: tag })).toEqual([id]);
    expect((await get(`/api/lotes/${id}`)).statusCode).toBe(200);
    expect(scryfall.requisicoes()).toEqual([]);
  });

  it('nenhuma resposta da vitrine leva dados de usuário', async () => {
    const lider = await conta('licitante');
    const tag = novaTag();
    await lote({ titulo: tag, lider_id: lider.id, lance_atual_centavos: 500, total_lances: 1 });
    const resposta = await get(`/api/lotes?q=${tag}`);
    expect(resposta.statusCode).toBe(200);
    for (const valor of [lider.nome, lider.email, lider.id, leiloeiro.id, leiloeiro.nome]) {
      expect(resposta.body).not.toContain(valor);
    }
  });
});
