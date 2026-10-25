// Integração (Postgres e Redis reais, Scryfall falsa): criação de lote e painel do leiloeiro
// (specs/006 §Criação e §Painel; tarefa 056). Toda resposta HTTP é validada contra o openapi.yaml
// pelo app de teste.
import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { LightMyRequestResponse } from 'fastify';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ServicoDeCatalogo } from '../../../src/modules/catalogo/index.js';
import { emitirAccessToken } from '../../../src/modules/identidade/tokens.js';
import { apagarChavesDoPrefixo, clienteDeTeste } from '../../common/limite/redis-de-teste.js';
import { criarAppDeTeste } from '../../helpers/app-de-teste.js';
import { ID_CARTA_SEM_IMAGEM, ID_CARTA_SIMPLES } from '../../helpers/fixtures-scryfall/cartas.js';
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

interface Conta {
  readonly id: string;
  readonly nome: string;
  readonly email: string;
  readonly cabecalhos: Cabecalhos;
}

const CSRF = 'csrf-de-teste-dos-lotes';
const SEGUNDO = 1000;
const MINUTO = 60 * SEGUNDO;
const DIA = 24 * 60 * MINUTO;
const ID_INEXISTENTE = '99999999-9999-4999-8999-999999999999';
const CARTAS = [ID_CARTA_SIMPLES, ID_CARTA_SEM_IMAGEM, ID_INEXISTENTE];

const iso = (ms: number): string => new Date(ms).toISOString();

function chavesDoCatalogo(): string[] {
  return [
    'scryfall:circuito',
    'scryfall:bucket:search',
    'scryfall:bucket:default',
    ...CARTAS.map((id) => `scryfall:carta:${id}`),
  ];
}

/** Chaves do JSON em qualquer profundidade. */
function chavesDe(valor: unknown): string[] {
  if (Array.isArray(valor)) return valor.flatMap(chavesDe);
  if (valor !== null && typeof valor === 'object') {
    return Object.entries(valor).flatMap(([k, v]) => [k, ...chavesDe(v)]);
  }
  return [];
}

describe.skipIf(!INFRA_DISPONIVEL)('lotes: criação e painel com Postgres e Scryfall falsa', () => {
  let app: NestFastifyApplication;
  let scryfall: ScryfallFalsa;
  let pool: pg.Pool;
  let redis: Awaited<ReturnType<typeof clienteDeTeste>>;
  const prefixoDoLimite = `ratelimit:teste-${randomUUID()}:`;
  const usuarios: string[] = [];

  beforeAll(async () => {
    scryfall = await iniciarScryfallFalsa();
    const base = envReal();
    app = await criarAppDeTeste({
      env: { ...base, scryfall: { ...base.scryfall, baseUrl: scryfall.url } },
      clientesReais: true,
      prefixoDoLimite,
    });
    pool = new pg.Pool(BANCO.conexao());
    redis = await clienteDeTeste(REDIS.conexao());
  });

  beforeEach(async () => {
    scryfall.definirModo('ok');
    scryfall.zerar();
    await redis.del(chavesDoCatalogo());
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
    await redis.del(chavesDoCatalogo());
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

  function criar(payload: unknown, headers: Cabecalhos = {}): Promise<LightMyRequestResponse> {
    return app.inject({
      method: 'POST',
      url: '/api/painel/lotes',
      headers: { 'content-type': 'application/json', ...headers },
      payload: JSON.stringify(payload),
    });
  }

  function get(url: string, headers: Cabecalhos = {}): Promise<LightMyRequestResponse> {
    return app.inject({ method: 'GET', url, headers });
  }

  function corpo(extra: Record<string, unknown> = {}): Record<string, unknown> {
    const inicio = Date.now() + MINUTO * 10;
    return {
      scryfallId: ID_CARTA_SIMPLES,
      lanceInicialCentavos: 1500,
      incrementoMinimoCentavos: 100,
      inicioEm: iso(inicio),
      fimEm: iso(inicio + DIA),
      ...extra,
    };
  }

  /** Lotes do leiloeiro (o banco do worktree é compartilhado por arquivos de teste paralelos). */
  async function lotesDe(leiloeiroId: string): Promise<number> {
    const { rows } = await pool.query<{ n: number }>(
      'select count(*)::int as n from lots where leiloeiro_id = $1',
      [leiloeiroId],
    );
    return rows[0]?.n ?? -1;
  }

  async function snapshotExiste(id: string): Promise<boolean> {
    const { rows } = await pool.query('select 1 from card_snapshots where id = $1', [id]);
    return rows.length > 0;
  }
  /** Lote gravado direto no banco, com um snapshot copiado de outro (para o painel). */
  async function loteDireto(
    leiloeiroId: string,
    snapshotBase: string,
    extra: Readonly<Record<string, string | number | null>> = {},
  ): Promise<string> {
    const { rows: snap } = await pool.query<{ id: string }>(
      `insert into card_snapshots
         (scryfall_id, nome, colecao, raridade, tipo, texto_oracle, artista, dados, imagem,
          imagem_mime, imagem_sha256)
       select scryfall_id, nome, colecao, raridade, tipo, texto_oracle, artista, dados, imagem,
              imagem_mime, imagem_sha256
         from card_snapshots where id = $1
       returning id`,
      [snapshotBase],
    );
    const colunas = {
      leiloeiro_id: leiloeiroId,
      snapshot_id: snap[0]?.id ?? null,
      carta_nome: 'Lightning Bolt',
      raridade: 'common',
      titulo: 'Lote direto',
      lance_inicial_centavos: 100,
      incremento_minimo_centavos: 100,
      inicio_em: iso(Date.now() - DIA),
      fim_em: iso(Date.now() - DIA + 10 * MINUTO),
      fim_original_em: iso(Date.now() - DIA + 10 * MINUTO),
      status: 'ao_vivo',
      ...extra,
    };
    const nomes = Object.keys(colunas);
    const { rows } = await pool.query<{ id: string }>(
      `insert into lots (${nomes.join(', ')})
       values (${nomes.map((_, i) => `$${String(i + 1)}`).join(', ')}) returning id`,
      Object.values(colunas),
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('insert em lots não devolveu o id');
    return id;
  }

  async function snapshotDe(loteId: string): Promise<string> {
    const { rows } = await pool.query<{ snapshot_id: string }>(
      'select snapshot_id from lots where id = $1',
      [loteId],
    );
    const id = rows[0]?.snapshot_id;
    if (id === undefined) throw new Error('lote sem snapshot');
    return id;
  }

  describe('acesso às rotas do painel', () => {
    it('anônimo → 401 e licitante → 403 PAPEL_NAO_PERMITIDO, sem chamar a Scryfall', async () => {
      const licitante = await conta('licitante');
      const anonimo = { cookie: `csrf_token=${CSRF}`, 'x-csrf-token': CSRF };
      expect((await criar(corpo(), anonimo)).statusCode).toBe(401);
      expect((await get('/api/painel/lotes')).statusCode).toBe(401);
      expect((await get('/api/painel/resumo')).statusCode).toBe(401);
      for (const r of [
        await criar(corpo(), licitante.cabecalhos),
        await get('/api/painel/lotes', licitante.cabecalhos),
        await get('/api/painel/resumo', licitante.cabecalhos),
      ]) {
        expect(r.statusCode).toBe(403);
        expect(r.json()).toMatchObject({ erro: { codigo: 'PAPEL_NAO_PERMITIDO' } });
      }
      expect(scryfall.requisicoes()).toHaveLength(0);
    });
  });

  describe('POST /api/painel/lotes', () => {
    it('início futuro → 201 agendado, título = nome da carta, linha gravada com a cópia', async () => {
      const leiloeiro = await conta('leiloeiro');
      const entrada = corpo({ descricao: '   ' });
      const r = await criar(entrada, leiloeiro.cabecalhos);
      expect(r.statusCode).toBe(201);
      const { dados } = r.json<{ dados: Record<string, unknown> }>();
      expect(dados).toMatchObject({
        titulo: 'Lightning Bolt',
        status: 'agendado',
        cartaNome: 'Lightning Bolt',
        raridade: 'common',
        inicioEm: entrada['inicioEm'],
        fimEm: entrada['fimEm'],
        lanceInicialCentavos: 1500,
        incrementoMinimoCentavos: 100,
        lanceAtualCentavos: null,
        precoAtualCentavos: 1500,
        totalLances: 0,
        valorArremateCentavos: null,
      });
      const { rows } = await pool.query<Record<string, unknown>>(
        `select l.leiloeiro_id, l.descricao, l.status, l.fim_original_em = l.fim_em as fim_igual,
                s.nome, l.snapshot_id
           from lots l join card_snapshots s on s.id = l.snapshot_id where l.id = $1`,
        [dados['id']],
      );
      expect(rows[0]).toMatchObject({
        leiloeiro_id: leiloeiro.id,
        descricao: null,
        status: 'agendado',
        fim_igual: true,
        nome: 'Lightning Bolt',
      });
      expect(dados['imagemUrl']).toBe(`/api/imagens/${String(rows[0]?.['snapshot_id'])}`);
    });

    it('início = agora − 1 min (com folga) → 201 ao_vivo; título e descrição sem espaços', async () => {
      const leiloeiro = await conta('leiloeiro');
      const inicio = Date.now() - 55 * SEGUNDO;
      const r = await criar(
        corpo({
          titulo: '  Meu lote  ',
          descricao: '  Carta em ótimo estado  ',
          inicioEm: iso(inicio),
          fimEm: iso(inicio + 5 * MINUTO),
        }),
        leiloeiro.cabecalhos,
      );
      expect(r.statusCode).toBe(201);
      const { dados } = r.json<{ dados: { id: string; status: string; titulo: string } }>();
      expect(dados.status).toBe('ao_vivo');
      expect(dados.titulo).toBe('Meu lote');
      const { rows } = await pool.query<{ status: string; descricao: string }>(
        'select status, descricao from lots where id = $1',
        [dados.id],
      );
      expect(rows[0]).toEqual({ status: 'ao_vivo', descricao: 'Carta em ótimo estado' });
    });

    it.each([
      ['início 61 s no passado', { inicioEm: iso(Date.now() - 61 * SEGUNDO) }, 'inicioEm'],
      ['título de 121 caracteres', { titulo: 'a'.repeat(121) }, 'titulo'],
      ['lance de 99 centavos', { lanceInicialCentavos: 99 }, 'lanceInicialCentavos'],
      ['campo desconhecido', { status: 'encerrado' }, 'status'],
    ])('%s → 422 com detalhes.campo, sem chamar a Scryfall', async (_caso, extra, campo) => {
      const leiloeiro = await conta('leiloeiro');
      const gravacao = vi.spyOn(app.get(ServicoDeCatalogo), 'gravarSnapshot');
      const r = await criar(corpo(extra), leiloeiro.cabecalhos);
      expect(r.statusCode).toBe(422);
      expect(r.json()).toMatchObject({ erro: { codigo: 'DADOS_INVALIDOS', detalhes: { campo } } });
      expect(scryfall.requisicoes()).toHaveLength(0);
      expect(gravacao).not.toHaveBeenCalled();
      expect(await lotesDe(leiloeiro.id)).toBe(0);
    });

    it.each([
      ['Scryfall bloqueada', 'bloqueada'],
      ['imagem inválida (Content-Type errado)', 'mime_errado'],
    ] as const)('%s → 503 e nenhuma linha em lots nem card_snapshots', async (_caso, modo) => {
      const leiloeiro = await conta('leiloeiro');
      const gravacao = vi.spyOn(app.get(ServicoDeCatalogo), 'gravarSnapshot');
      scryfall.definirModo(modo);
      const r = await criar(corpo(), leiloeiro.cabecalhos);
      expect(r.statusCode).toBe(503);
      expect(r.json()).toMatchObject({ erro: { codigo: 'CATALOGO_INDISPONIVEL' } });
      expect(gravacao).not.toHaveBeenCalled();
      expect(await lotesDe(leiloeiro.id)).toBe(0);
    });

    it('carta inexistente ou sem imagem → 422 com campo scryfallId', async () => {
      const leiloeiro = await conta('leiloeiro');
      const gravacao = vi.spyOn(app.get(ServicoDeCatalogo), 'gravarSnapshot');
      for (const scryfallId of [ID_INEXISTENTE, ID_CARTA_SEM_IMAGEM]) {
        const r = await criar(corpo({ scryfallId }), leiloeiro.cabecalhos);
        expect(r.statusCode).toBe(422);
        expect(r.json()).toMatchObject({ erro: { detalhes: { campo: 'scryfallId' } } });
      }
      expect(gravacao).not.toHaveBeenCalled();
      expect(await lotesDe(leiloeiro.id)).toBe(0);
    });

    it('falha depois de gravarSnapshot(tx) desfaz tudo: nem snapshot nem lote', async () => {
      const leiloeiro = await conta('leiloeiro');
      const catalogo = app.get(ServicoDeCatalogo);
      const original = catalogo.gravarSnapshot.bind(catalogo);
      const gravados: string[] = [];
      vi.spyOn(catalogo, 'gravarSnapshot').mockImplementation(async (tx, preparado) => {
        gravados.push(await original(tx, preparado));
        throw new Error('falha simulada depois do snapshot');
      });
      const r = await criar(corpo(), leiloeiro.cabecalhos);
      expect(r.statusCode).toBe(500);
      expect(gravados).toHaveLength(1);
      expect(await snapshotExiste(gravados[0] ?? '')).toBe(false);
      expect(await lotesDe(leiloeiro.id)).toBe(0);
    });
  });

  describe('GET /api/painel/lotes e /api/painel/resumo', () => {
    it('lista só os lotes do dono, inclusive cancelados, do mais recente ao mais antigo', async () => {
      const dono = await conta('leiloeiro');
      const outro = await conta('leiloeiro');
      const criado = await criar(corpo(), dono.cabecalhos);
      const primeiro = criado.json<{ dados: { id: string } }>().dados.id;
      const base = await snapshotDe(primeiro);
      const cancelado = await loteDireto(dono.id, base, {
        status: 'cancelado',
        cancelado_em: iso(Date.now()),
      });
      await loteDireto(outro.id, base);

      const r = await get('/api/painel/lotes', dono.cabecalhos);
      expect(r.statusCode).toBe(200);
      const { dados, meta } = r.json<{ dados: { id: string; status: string }[]; meta: unknown }>();
      expect(meta).toEqual({ total: 2, pagina: 1, limite: 24 });
      expect(dados.map((l) => [l.id, l.status])).toEqual([
        [cancelado, 'cancelado'],
        [primeiro, 'agendado'],
      ]);
    });

    it('24 por página, página além da última vazia e pagina inválida → 422', async () => {
      const dono = await conta('leiloeiro');
      const criado = await criar(corpo(), dono.cabecalhos);
      const base = await snapshotDe(criado.json<{ dados: { id: string } }>().dados.id);
      for (let i = 0; i < 24; i += 1) await loteDireto(dono.id, base);

      const ids = async (pagina: number): Promise<string[]> => {
        const r = await get(`/api/painel/lotes?pagina=${String(pagina)}`, dono.cabecalhos);
        expect(r.statusCode).toBe(200);
        expect(r.json()).toMatchObject({ meta: { total: 25, pagina, limite: 24 } });
        return r.json<{ dados: { id: string }[] }>().dados.map((l) => l.id);
      };
      const p1 = await ids(1);
      const p2 = await ids(2);
      expect(p1).toHaveLength(24);
      expect(p2).toHaveLength(1);
      expect(new Set([...p1, ...p2]).size).toBe(25);
      expect(await ids(3)).toEqual([]);
      for (const pagina of ['0', '501', 'x']) {
        const r = await get(`/api/painel/lotes?pagina=${pagina}`, dono.cabecalhos);
        expect(r.statusCode).toBe(422);
        expect(r.json()).toMatchObject({ erro: { detalhes: { campo: 'pagina' } } });
      }
    });

    it('resumo: zeros sem encerrados; depois soma só os encerrados do próprio usuário', async () => {
      const dono = await conta('leiloeiro');
      const outro = await conta('leiloeiro');
      const licitante = await conta('licitante');
      const zerado = await get('/api/painel/resumo', dono.cabecalhos);
      expect(zerado.statusCode).toBe(200);
      expect(zerado.json()).toEqual({
        sucesso: true,
        dados: { totalRecebidoCentavos: 0, lotesArrematados: 0, lotesSemLance: 0 },
      });

      const criado = await criar(corpo(), dono.cabecalhos);
      const base = await snapshotDe(criado.json<{ dados: { id: string } }>().dados.id);
      const arrematado = {
        status: 'encerrado',
        encerrado_em: iso(Date.now()),
        vencedor_id: licitante.id,
        lider_id: licitante.id,
        lance_atual_centavos: 5000,
        valor_arremate_centavos: 5000,
        total_lances: 3,
      };
      await loteDireto(dono.id, base, arrematado);
      await loteDireto(dono.id, base, { ...arrematado, valor_arremate_centavos: 2500 });
      await loteDireto(dono.id, base, { status: 'encerrado', encerrado_em: iso(Date.now()) });
      // Não contam: lote de outro leiloeiro, ao_vivo com fim passado (status gravado) e cancelado.
      await loteDireto(outro.id, base, arrematado);
      await loteDireto(dono.id, base, { lance_atual_centavos: 900, total_lances: 1 });
      await loteDireto(dono.id, base, { status: 'cancelado', cancelado_em: iso(Date.now()) });

      const r = await get('/api/painel/resumo', dono.cabecalhos);
      expect(r.json()).toEqual({
        sucesso: true,
        dados: { totalRecebidoCentavos: 7500, lotesArrematados: 2, lotesSemLance: 1 },
      });

      const lista = await get('/api/painel/lotes', dono.cabecalhos);
      const lotes = lista.json<{ dados: Record<string, unknown>[] }>().dados;
      expect(lotes.filter((l) => l['valorArremateCentavos'] === 5000)).toHaveLength(1);
      // Status derivado: o ao_vivo com fim no passado aparece como encerrado.
      expect(lotes.find((l) => l['lanceAtualCentavos'] === 900)?.['status']).toBe('encerrado');
    });

    it('nenhuma resposta do painel traz nome ou e-mail de usuário', async () => {
      const dono = await conta('leiloeiro');
      const licitante = await conta('licitante');
      const criado = await criar(corpo(), dono.cabecalhos);
      const base = await snapshotDe(criado.json<{ dados: { id: string } }>().dados.id);
      await loteDireto(dono.id, base, {
        status: 'encerrado',
        encerrado_em: iso(Date.now()),
        vencedor_id: licitante.id,
        lance_atual_centavos: 300,
        valor_arremate_centavos: 300,
        total_lances: 1,
      });
      const respostas = [
        criado,
        await get('/api/painel/lotes', dono.cabecalhos),
        await get('/api/painel/resumo', dono.cabecalhos),
      ];
      for (const r of respostas) {
        for (const pessoa of [dono, licitante]) {
          expect(r.body).not.toContain(pessoa.nome);
          expect(r.body).not.toContain(pessoa.email);
          expect(r.body).not.toContain(pessoa.id);
        }
        const chaves = chavesDe(r.json());
        expect(chaves).not.toContain('nome');
        expect(chaves).not.toContain('email');
      }
    });
  });
});
