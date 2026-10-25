// QA (tarefa 061): critérios de aceite de specs/005 provados pela API HTTP real (Postgres e Redis
// reais, Scryfall falsa): (1) Scryfall bloqueada não derruba imagem nem snapshot; (2) 20 buscas
// simultâneas respeitam 2 req/s medidos no servidor falso; (3) um 429 abre o circuito por 30 s.
// Bucket, circuito e cache usam o prefixo próprio do arquivo (tarefa 067), nunca `scryfall:*`.
// Toda resposta HTTP é validada contra o openapi.yaml pelo `criarAppDeTeste`.
import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { LightMyRequestResponse } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { BANCO as TOKEN_DO_BANCO } from '../../src/config/banco.module.js';
import type { BancoVerificavel } from '../../src/db/banco.js';
import { ServicoDeCatalogo } from '../../src/modules/catalogo/index.js';
import { emitirAccessToken } from '../../src/modules/identidade/tokens.js';
import { apagarChavesDoPrefixo, clienteDeTeste, ttlDe } from '../common/limite/redis-de-teste.js';
import {
  apagarChavesDaScryfall,
  criarAppDeTeste,
  novoPrefixoDaScryfall,
} from '../helpers/app-de-teste.js';
import { ID_CARTA_SIMPLES } from '../helpers/fixtures-scryfall/cartas.js';
import { JPEG_MINIMO } from '../helpers/fixtures-scryfall/imagens.js';
import {
  iniciarScryfallFalsa,
  type RequisicaoRegistrada,
  type ScryfallFalsa,
} from '../helpers/scryfall-falsa.js';
import {
  BANCO,
  CHAVE_JWT,
  emailNovo,
  envReal,
  INFRA_DISPONIVEL,
  REDIS,
} from '../modules/identidade/ambiente.js';

type Cabecalhos = Readonly<Record<string, string>>;

const BUSCAS_SIMULTANEAS = 20;
const CIRCUITO_S = 30;
/** Janela deslizante de specs/005 (1 s) menos 50 ms de folga para o jitter de entrega do loopback. */
const JANELA_MS = 950;
const MAX_NA_JANELA = 2;
const TOTAL_SINTETICAS = 397;
const POR_PAGINA_DA_API = 25;

interface Erro503 {
  erro: { codigo: string; detalhes: { tenteNovamenteEm: number } };
}

/** Maior número de requisições que cabem numa janela deslizante de `janelaMs`, medido no servidor. */
function maximoNaJanela(registro: readonly RequisicaoRegistrada[], janelaMs: number): number {
  const instantes = registro.map((r) => r.instanteMs).sort((a, b) => a - b);
  return instantes.reduce((maior, inicio, i) => {
    const dentro = instantes.slice(i).filter((t) => t - inicio < janelaMs).length;
    return Math.max(maior, dentro);
  }, 0);
}

describe.skipIf(!INFRA_DISPONIVEL)('integração do catálogo (specs/005)', () => {
  let app: NestFastifyApplication;
  let scryfall: ScryfallFalsa;
  let pool: pg.Pool;
  let redis: Awaited<ReturnType<typeof clienteDeTeste>>;
  let catalogo: ServicoDeCatalogo;
  let banco: BancoVerificavel;
  const prefixoDoLimite = `ratelimit:teste-${randomUUID()}:`;
  const prefixoDaScryfall = novoPrefixoDaScryfall();
  const usuarios: string[] = [];
  const snapshots: string[] = [];

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
    catalogo = app.get(ServicoDeCatalogo);
    banco = app.get<BancoVerificavel>(TOKEN_DO_BANCO);
  });

  beforeEach(async () => {
    scryfall.definirModo('ok');
    scryfall.zerar();
    await apagarChavesDaScryfall(redis, prefixoDaScryfall);
  });

  afterAll(async () => {
    await pool.query('delete from card_snapshots where id = any($1::uuid[])', [snapshots]);
    await pool.query('delete from users where id = any($1::uuid[])', [usuarios]);
    await pool.end();
    await apagarChavesDaScryfall(redis, prefixoDaScryfall);
    await apagarChavesDoPrefixo(redis, prefixoDoLimite);
    redis.destroy();
    await app.close();
    await scryfall.fechar();
  });

  async function leiloeiro(): Promise<Cabecalhos> {
    const { rows } = await pool.query<{ id: string }>(
      `insert into users (nome, email, senha_hash, papel) values ($1, $2, $3, $4) returning id`,
      ['Leiloeiro de Teste', emailNovo(), 'hash-que-nao-e-usado', 'leiloeiro'],
    );
    const id = rows[0]?.id;
    if (id === undefined) throw new Error('insert em users não devolveu o id');
    usuarios.push(id);
    return {
      cookie: `access_token=${await emitirAccessToken(CHAVE_JWT, { id, papel: 'leiloeiro' })}`,
    };
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

  function busca(q: string, headers: Cabecalhos, pagina = 1): Promise<LightMyRequestResponse> {
    return get(`/api/catalogo/cartas?q=${encodeURIComponent(q)}&pagina=${pagina}`, headers);
  }

  describe('critério 1: Scryfall bloqueada', () => {
    it.each(['bloqueada', 'fora'] as const)(
      'modo %s: imagem de snapshot gravado responde 200 sem tocar o upstream; busca → 503 com tenteNovamenteEm',
      async (modo) => {
        const headers = await leiloeiro();
        const id = await criarSnapshot(ID_CARTA_SIMPLES);
        scryfall.definirModo(modo);
        scryfall.zerar();

        const imagem = await get(`/api/imagens/${id}`);
        expect(imagem.statusCode).toBe(200);
        expect(imagem.rawPayload.equals(JPEG_MINIMO)).toBe(true);
        expect(scryfall.requisicoes()).toHaveLength(0);

        const r = await busca('lightning', headers);
        expect(r.statusCode).toBe(503);
        const corpo = r.json<Erro503>();
        expect(corpo.erro.codigo).toBe('CATALOGO_INDISPONIVEL');
        expect(corpo.erro.detalhes.tenteNovamenteEm).toBeGreaterThanOrEqual(1);
        expect(r.headers['retry-after']).toBe(String(corpo.erro.detalhes.tenteNovamenteEm));

        // A imagem e o snapshot seguem de pé depois da falha da busca e sem nova chamada de imagem.
        const depois = await get(`/api/imagens/${id}`);
        expect(depois.statusCode).toBe(200);
        expect((await catalogo.obterSnapshot(id))?.nome).toBe('Lightning Bolt');
        expect(scryfall.requisicoes().every((q) => q.caminho.startsWith('/cards/search'))).toBe(
          true,
        );
      },
    );

    it('bloqueada (429 contínuo): a 1ª busca vê 1 requisição; as seguintes não chegam ao upstream', async () => {
      const headers = await leiloeiro();
      scryfall.definirModo('bloqueada');

      const primeira = await busca('lightning', headers);
      expect(primeira.statusCode).toBe(503);
      expect(primeira.json<Erro503>().erro.detalhes.tenteNovamenteEm).toBe(CIRCUITO_S);
      expect(scryfall.requisicoes()).toHaveLength(1);

      for (const q of ['delver', 'sintetica 001', 'host estranho']) {
        const r = await busca(q, headers);
        expect(r.statusCode).toBe(503);
        expect(r.json<Erro503>().erro.codigo).toBe('CATALOGO_INDISPONIVEL');
      }
      expect(scryfall.requisicoes()).toHaveLength(1);
    });
  });

  describe('critério 2: 20 buscas simultâneas diferentes', () => {
    it('no máximo 2 requisições por janela de 1 s no servidor falso', async () => {
      const headers = await leiloeiro();
      const consultas = Array.from({ length: BUSCAS_SIMULTANEAS }, (_, i) =>
        busca(`sintetica ${String(i + 1).padStart(3, '0')}`, headers),
      );
      const respostas = await Promise.all(consultas);

      const registro = scryfall.requisicoes();
      const buscasNoUpstream = registro.filter((r) => r.caminho.startsWith('/cards/search'));
      expect(buscasNoUpstream.length).toBe(registro.length);

      const medido = maximoNaJanela(buscasNoUpstream, JANELA_MS);
      expect(medido).toBeGreaterThanOrEqual(1);
      expect(medido).toBeLessThanOrEqual(MAX_NA_JANELA);

      // Quem não conseguiu ficha dentro da espera recebe CATALOGO_OCUPADO com tenteNovamenteEm 1;
      // quem conseguiu gerou exatamente uma requisição ao upstream.
      const aceitas = respostas.filter((r) => r.statusCode === 200);
      const recusadas = respostas.filter((r) => r.statusCode !== 200);
      expect(aceitas).toHaveLength(buscasNoUpstream.length);
      expect(aceitas.length).toBeGreaterThanOrEqual(1);
      expect(aceitas.length + recusadas.length).toBe(BUSCAS_SIMULTANEAS);
      for (const r of recusadas) {
        expect(r.statusCode).toBe(503);
        const corpo = r.json<Erro503>();
        expect(corpo.erro.codigo).toBe('CATALOGO_OCUPADO');
        expect(corpo.erro.detalhes.tenteNovamenteEm).toBe(1);
        expect(r.headers['retry-after']).toBe('1');
      }
    }, 15_000);
  });

  describe('critério 3: um 429 abre o circuito por 30 s', () => {
    it('TTL de <prefixo>circuito em (0, 30] e nenhuma chamada enquanto aberto', async () => {
      const headers = await leiloeiro();
      scryfall.definirModo('429');

      const primeira = await busca('lightning', headers);
      expect(primeira.statusCode).toBe(503);
      expect(primeira.json<Erro503>().erro).toMatchObject({
        codigo: 'CATALOGO_INDISPONIVEL',
        detalhes: { tenteNovamenteEm: CIRCUITO_S },
      });
      expect(primeira.headers['retry-after']).toBe(String(CIRCUITO_S));
      expect(scryfall.requisicoes()).toHaveLength(1);

      const ttl = await ttlDe(redis, `${prefixoDaScryfall}circuito`);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(CIRCUITO_S);

      // O modo '429' do servidor falso é de uma vez só: de volta ao ok, o upstream responderia.
      expect(scryfall.modo()).toBe('ok');
      for (const q of ['delver', 'sintetica 002']) {
        const r = await busca(q, headers);
        expect(r.statusCode).toBe(503);
        const corpo = r.json<Erro503>();
        expect(corpo.erro.codigo).toBe('CATALOGO_INDISPONIVEL');
        expect(corpo.erro.detalhes.tenteNovamenteEm).toBeLessThanOrEqual(CIRCUITO_S);
      }
      expect(scryfall.requisicoes()).toHaveLength(1);
      expect(await ttlDe(redis, `${prefixoDaScryfall}circuito`)).toBeGreaterThan(0);
    });

    it('a chave real scryfall:circuito não é tocada', async () => {
      const antes = await ttlDe(redis, 'scryfall:circuito');
      scryfall.definirModo('429');
      await busca('lightning', await leiloeiro());
      const depois = await ttlDe(redis, 'scryfall:circuito');
      // Sem a chave real, o TTL é -2 antes e depois; se outro processo a mantém, só diminui.
      if (antes === -2) {
        expect(depois).toBe(-2);
      } else {
        expect(depois).toBeLessThanOrEqual(antes);
      }
    });
  });

  describe('busca: páginas e miniaturas (notas da 054 e da revisão da 055)', () => {
    it('página parcial (16, 22 cartas) e vazia (17) sobre o fixture de total 397', async () => {
      const headers = await leiloeiro();
      const parcial = await busca('sintetica', headers, 16);
      expect(parcial.statusCode).toBe(200);
      const corpoParcial = parcial.json<{ dados: unknown[]; meta: unknown }>();
      expect(corpoParcial.dados).toHaveLength(TOTAL_SINTETICAS - 15 * POR_PAGINA_DA_API);
      expect(corpoParcial.meta).toEqual({ total: TOTAL_SINTETICAS, pagina: 16, limite: 25 });

      const vazia = await busca('sintetica', headers, 17);
      expect(vazia.statusCode).toBe(200);
      const corpoVazio = vazia.json<{ dados: unknown[]; meta: unknown }>();
      expect(corpoVazio.dados).toEqual([]);
      expect(corpoVazio.meta).toEqual({ total: TOTAL_SINTETICAS, pagina: 17, limite: 25 });
    });

    it('a busca devolve imagemUrl não nulo (image_uris.small das fixtures)', async () => {
      const r = await busca('sintetica', await leiloeiro());
      const { dados } = r.json<{ dados: { imagemUrl: string | null }[] }>();
      expect(dados.length).toBeGreaterThan(0);
      expect(dados.every((c) => typeof c.imagemUrl === 'string' && c.imagemUrl.length > 0)).toBe(
        true,
      );
    });
  });
});
