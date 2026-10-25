// Integração (Postgres e Redis reais, Scryfall falsa): busca, snapshot e imagem (specs/005;
// tarefa 055). SCRYFALL_BASE_URL aponta para a falsa, então as imagens dela (http no loopback)
// entram pela origem sobrescrita. Toda resposta HTTP é validada contra o openapi.yaml.
import { createHash, randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { LightMyRequestResponse } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ErroApi } from '../../../src/common/erros/erro-api.js';
import { BANCO as TOKEN_DO_BANCO } from '../../../src/config/banco.module.js';
import type { BancoVerificavel } from '../../../src/db/banco.js';
import { ServicoDeCatalogo } from '../../../src/modules/catalogo/index.js';
import { emitirAccessToken } from '../../../src/modules/identidade/tokens.js';
import { apagarChavesDoPrefixo, clienteDeTeste } from '../../common/limite/redis-de-teste.js';
import { criarAppDeTeste } from '../../helpers/app-de-teste.js';
import {
  ID_CARTA_DUPLA_FACE,
  ID_CARTA_HOST_ESTRANHO,
  ID_CARTA_SEM_IMAGEM,
  ID_CARTA_SIMPLES,
  miniaturaDaScryfall,
} from '../../helpers/fixtures-scryfall/cartas.js';
import { JPEG_MINIMO, PNG_MINIMO } from '../../helpers/fixtures-scryfall/imagens.js';
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

const ID_INEXISTENTE = '99999999-9999-4999-8999-999999999999';
/** Buscas que os testes fazem (o cache delas é apagado entre os testes). */
const BUSCAS = [
  'bolt',
  'sintetica',
  'lightning',
  'delver',
  'host estranho',
  'carta sem imagem',
  'inexistente',
];
const CARTAS = [
  ID_CARTA_SIMPLES,
  ID_CARTA_DUPLA_FACE,
  ID_CARTA_SEM_IMAGEM,
  ID_CARTA_HOST_ESTRANHO,
  ID_INEXISTENTE,
];
const PAGINAS_SCRYFALL = [1, 2];

/**
 * Chaves `scryfall:*` que estes testes tocam (cache/redis/README.md). O provider usa o prefixo
 * fixo, então o reset apaga só essas chaves pelo nome, sem SCAN no prefixo inteiro.
 */
function chavesDoCatalogo(): string[] {
  const sha1 = (q: string): string => createHash('sha1').update(q).digest('hex');
  return [
    'scryfall:circuito',
    'scryfall:bucket:search',
    'scryfall:bucket:default',
    ...CARTAS.map((id) => `scryfall:carta:${id}`),
    ...BUSCAS.flatMap((q) => PAGINAS_SCRYFALL.map((n) => `scryfall:busca:${sha1(q)}:${n}`)),
  ];
}

describe.skipIf(!INFRA_DISPONIVEL)('catálogo com Postgres, Redis e Scryfall falsa', () => {
  let app: NestFastifyApplication;
  let scryfall: ScryfallFalsa;
  let pool: pg.Pool;
  let redis: Awaited<ReturnType<typeof clienteDeTeste>>;
  let catalogo: ServicoDeCatalogo;
  let banco: BancoVerificavel;
  const prefixoDoLimite = `ratelimit:teste-${randomUUID()}:`;
  const usuarios: string[] = [];
  const snapshots: string[] = [];

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
    catalogo = app.get(ServicoDeCatalogo);
    banco = app.get<BancoVerificavel>(TOKEN_DO_BANCO);
  });

  beforeEach(async () => {
    scryfall.definirModo('ok');
    scryfall.zerar();
    // Cache, bucket e circuito do catálogo começam vazios em cada teste.
    await redis.del(chavesDoCatalogo());
  });

  afterAll(async () => {
    await pool.query('delete from card_snapshots where id = any($1::uuid[])', [snapshots]);
    await pool.query('delete from users where id = any($1::uuid[])', [usuarios]);
    await pool.end();
    await redis.del(chavesDoCatalogo());
    await apagarChavesDoPrefixo(redis, prefixoDoLimite);
    redis.destroy();
    await app.close();
    await scryfall.fechar();
  });

  async function sessao(papel: Papel): Promise<Cabecalhos> {
    const { rows } = await pool.query<{ id: string }>(
      `insert into users (nome, email, senha_hash, papel) values ($1, $2, $3, $4) returning id`,
      ['Conta de Teste', emailNovo(), 'hash-que-nao-e-usado', papel],
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('insert em users não devolveu o id');
    usuarios.push(id);
    return { cookie: `access_token=${await emitirAccessToken(CHAVE_JWT, { id, papel })}` };
  }

  function get(url: string, headers: Cabecalhos = {}): Promise<LightMyRequestResponse> {
    return app.inject({ method: 'GET', url, headers });
  }

  async function criarSnapshot(scryfallId: string): Promise<string> {
    const preparado = await catalogo.prepararSnapshot(scryfallId);
    const id = await banco.transaction((tx) => catalogo.gravarSnapshot(tx, preparado));
    snapshots.push(id);
    return id;
  }

  async function linhasDaCarta(scryfallId: string): Promise<number> {
    const { rows } = await pool.query<{ n: number }>(
      'select count(*)::int as n from card_snapshots where scryfall_id = $1',
      [scryfallId],
    );
    return rows[0]?.n ?? -1;
  }

  async function falhaDoPreparo(scryfallId: string): Promise<ErroApi> {
    const erro: unknown = await catalogo.prepararSnapshot(scryfallId).then(
      () => undefined,
      (e: unknown) => e,
    );
    if (!(erro instanceof ErroApi)) throw new Error('o preparo não falhou com ErroApi');
    return erro;
  }

  describe('GET /api/catalogo/cartas', () => {
    it('anônimo → 401; licitante → 403 PAPEL_NAO_PERMITIDO', async () => {
      expect((await get('/api/catalogo/cartas?q=bolt')).statusCode).toBe(401);
      const licitante = await get('/api/catalogo/cartas?q=bolt', await sessao('licitante'));
      expect(licitante.statusCode).toBe(403);
      expect(licitante.json()).toMatchObject({ erro: { codigo: 'PAPEL_NAO_PERMITIDO' } });
      expect(scryfall.requisicoes()).toHaveLength(0);
    });

    it('leiloeiro: páginas 1, 7 e 8 sobre as páginas 1 e 2 da Scryfall', async () => {
      const leiloeiro = await sessao('leiloeiro');
      const nomes = async (pagina: number): Promise<string[]> => {
        const r = await get(`/api/catalogo/cartas?q=sintetica&pagina=${pagina}`, leiloeiro);
        expect(r.statusCode).toBe(200);
        expect(r.json()).toMatchObject({ meta: { total: 397, pagina, limite: 25 } });
        return (r.json() as { dados: { nome: string }[] }).dados.map((c) => c.nome);
      };
      const nome = (n: number): string => `Carta Sintetica ${String(n).padStart(3, '0')}`;
      expect(await nomes(1)).toEqual(Array.from({ length: 25 }, (_, i) => nome(i + 1)));
      expect(await nomes(7)).toEqual(Array.from({ length: 25 }, (_, i) => nome(i + 151)));
      expect(await nomes(8)).toEqual(Array.from({ length: 25 }, (_, i) => nome(i + 176)));
      // 1 e 7 compartilham a página 1 da Scryfall (a segunda vem do cache).
      const paginas = scryfall
        .requisicoes()
        .map((r) => new URL(r.caminho, 'http://x').searchParams);
      expect(paginas.map((p) => p.get('page'))).toEqual(['1', '2']);
      expect(paginas[0]?.get('unique')).toBe('cards');
      expect(paginas[0]?.get('order')).toBe('name');
    });

    it('imagemUrl: miniatura de cards.scryfall.io, card_faces[0] e null para host estranho', async () => {
      const leiloeiro = await sessao('leiloeiro');
      const carta = async (q: string): Promise<Record<string, unknown> | undefined> =>
        (
          (await get(`/api/catalogo/cartas?q=${encodeURIComponent(q)}`, leiloeiro)).json() as {
            dados: Record<string, unknown>[];
          }
        ).dados[0];
      expect(await carta('lightning')).toEqual({
        scryfallId: ID_CARTA_SIMPLES,
        nome: 'Lightning Bolt',
        colecao: 'Conjunto de Teste',
        raridade: 'common',
        tipo: 'Instant',
        artista: 'Artista de Teste',
        imagemUrl: miniaturaDaScryfall(ID_CARTA_SIMPLES),
      });
      expect((await carta('delver'))?.['imagemUrl']).toBe(miniaturaDaScryfall(ID_CARTA_DUPLA_FACE));
      expect((await carta('host estranho'))?.['imagemUrl']).toBeNull();
      expect((await carta('carta sem imagem'))?.['imagemUrl']).toBeNull();
    });

    it('nenhuma carta (404 da Scryfall) → 200 com lista vazia e total 0', async () => {
      const r = await get('/api/catalogo/cartas?q=inexistente', await sessao('leiloeiro'));
      expect(r.statusCode).toBe(200);
      expect(r.json()).toEqual({
        sucesso: true,
        dados: [],
        meta: { total: 0, pagina: 1, limite: 25 },
      });
    });

    it.each([
      ['pagina=501', 'q=bolt&pagina=501', 'pagina'],
      ['pagina=0', 'q=bolt&pagina=0', 'pagina'],
      ['q vazio', 'q=&pagina=1', 'q'],
      ['sem q', 'pagina=1', 'q'],
      ['q com 201 caracteres', `q=${'a'.repeat(201)}`, 'q'],
      ['q com espaço na ponta', 'q=%20bolt', 'q'],
    ])('%s → 422 com detalhes.campo', async (_caso, query, campo) => {
      const r = await get(`/api/catalogo/cartas?${query}`, await sessao('leiloeiro'));
      expect(r.statusCode).toBe(422);
      expect(r.json()).toMatchObject({ erro: { codigo: 'DADOS_INVALIDOS', detalhes: { campo } } });
      expect(scryfall.requisicoes()).toHaveLength(0);
    });

    it('Scryfall fora → 503 CATALOGO_INDISPONIVEL com Retry-After', async () => {
      scryfall.definirModo('5xx');
      const r = await get('/api/catalogo/cartas?q=bolt', await sessao('leiloeiro'));
      expect(r.statusCode).toBe(503);
      expect(r.json()).toMatchObject({ erro: { codigo: 'CATALOGO_INDISPONIVEL' } });
      expect(r.headers['retry-after']).toBe('5');
    });
  });

  describe('snapshot', () => {
    it('grava a carta simples (JPEG) com SHA-256 e obterSnapshot devolve os campos', async () => {
      const id = await criarSnapshot(ID_CARTA_SIMPLES);
      const { rows } = await pool.query<{ imagem: Buffer; mime: string; sha: Buffer }>(
        'select imagem, imagem_mime as mime, imagem_sha256 as sha from card_snapshots where id = $1',
        [id],
      );
      expect(rows[0]?.mime).toBe('image/jpeg');
      expect(rows[0]?.imagem.equals(JPEG_MINIMO)).toBe(true);
      expect(rows[0]?.sha.equals(createHash('sha256').update(JPEG_MINIMO).digest())).toBe(true);
      expect(await catalogo.obterSnapshot(id)).toEqual({
        scryfallId: ID_CARTA_SIMPLES,
        nome: 'Lightning Bolt',
        colecao: 'Conjunto de Teste',
        raridade: 'common',
        tipo: 'Instant',
        textoOracle: 'Texto de teste.',
        artista: 'Artista de Teste',
      });
    });

    it('dupla-face usa card_faces[0] (PNG) e o texto das faces', async () => {
      const id = await criarSnapshot(ID_CARTA_DUPLA_FACE);
      const imagem = await get(`/api/imagens/${id}`);
      expect(imagem.headers['content-type']).toBe('image/png');
      expect(imagem.rawPayload.equals(PNG_MINIMO)).toBe(true);
      expect((await catalogo.obterSnapshot(id))?.textoOracle).toContain('Delver of Secrets');
    });

    it.each([
      ['imagem acima de 1 MB', 'imagem_grande', ID_CARTA_SIMPLES],
      ['Content-Type fora de JPEG/PNG', 'mime_errado', ID_CARTA_SIMPLES],
      ['host fora da allowlist', 'ok', ID_CARTA_HOST_ESTRANHO],
    ] as const)('%s → 503 CATALOGO_INDISPONIVEL sem linha gravada', async (_caso, modo, id) => {
      const antes = await linhasDaCarta(id);
      scryfall.definirModo(modo);
      const erro = await falhaDoPreparo(id);
      expect(erro.status).toBe(503);
      expect(erro.codigo).toBe('CATALOGO_INDISPONIVEL');
      expect(erro.retryAfterSegundos).toBe(5);
      expect(await linhasDaCarta(id)).toBe(antes);
    });

    it('host fora da allowlist não gera requisição de imagem', async () => {
      await falhaDoPreparo(ID_CARTA_HOST_ESTRANHO);
      expect(scryfall.requisicoes().map((r) => r.caminho)).toEqual([
        `/cards/${ID_CARTA_HOST_ESTRANHO}`,
      ]);
    });

    it.each([
      ['carta sem imagem', ID_CARTA_SEM_IMAGEM],
      ['carta inexistente', ID_INEXISTENTE],
      ['scryfallId que não é UUID', 'nao-e-uuid'],
    ])('%s → 422 DADOS_INVALIDOS com campo scryfallId', async (_caso, id) => {
      const erro = await falhaDoPreparo(id);
      expect(erro.status).toBe(422);
      expect(erro.detalhes).toEqual({ campo: 'scryfallId' });
      expect(await linhasDaCarta(ID_CARTA_SEM_IMAGEM)).toBe(0);
    });

    it('obterSnapshot de id inexistente ou não UUID → null', async () => {
      expect(await catalogo.obterSnapshot(ID_INEXISTENTE)).toBeNull();
      expect(await catalogo.obterSnapshot('x')).toBeNull();
    });
  });

  describe('GET /api/imagens/{snapshotId}', () => {
    it('com a Scryfall bloqueada, imagem e obterSnapshot respondem sem chamar o upstream', async () => {
      const id = await criarSnapshot(ID_CARTA_SIMPLES);
      scryfall.definirModo('bloqueada');
      scryfall.zerar();
      const r = await get(`/api/imagens/${id}`);
      expect(r.statusCode).toBe(200);
      expect(r.rawPayload.equals(JPEG_MINIMO)).toBe(true);
      expect(r.headers).toMatchObject({
        'content-type': 'image/jpeg',
        'cache-control': 'public, max-age=31536000, immutable',
        etag: `"${createHash('sha256').update(JPEG_MINIMO).digest('hex')}"`,
        'x-content-type-options': 'nosniff',
      });
      expect((await catalogo.obterSnapshot(id))?.nome).toBe('Lightning Bolt');
      expect(scryfall.requisicoes()).toHaveLength(0);
    });

    it('If-None-Match com o ETag (exato, W/ ou em lista) → 304 sem corpo', async () => {
      const id = await criarSnapshot(ID_CARTA_SIMPLES);
      const etag = String((await get(`/api/imagens/${id}`)).headers.etag);
      for (const valor of [etag, `W/${etag}`, `"outro", ${etag}`]) {
        const r = await get(`/api/imagens/${id}`, { 'if-none-match': valor });
        expect(r.statusCode).toBe(304);
        expect(r.body).toBe('');
        expect(r.headers.etag).toBe(etag);
        expect(r.headers['cache-control']).toBe('public, max-age=31536000, immutable');
      }
      const outro = await get(`/api/imagens/${id}`, { 'if-none-match': '"outro"' });
      expect(outro.statusCode).toBe(200);
    });

    it.each([ID_INEXISTENTE, 'nao-e-uuid'])('%s → 404 NAO_ENCONTRADO', async (id) => {
      const r = await get(`/api/imagens/${id}`);
      expect(r.statusCode).toBe(404);
      expect(r.json()).toMatchObject({ erro: { codigo: 'NAO_ENCONTRADO' } });
    });
  });
});
