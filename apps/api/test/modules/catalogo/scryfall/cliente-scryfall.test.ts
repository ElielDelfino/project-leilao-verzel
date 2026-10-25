// Cliente da Scryfall (tarefa 054, specs/005 §Cliente HTTP, bucket e circuito): Scryfall falsa
// (tarefa 052) e Redis real. Cada teste usa um prefixo próprio de chaves, então bucket, circuito e
// cache não vazam entre testes nem entre worktrees; toda chave tem TTL.
import { createHash, randomBytes } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ErroApi } from '../../../../src/common/erros/erro-api.js';
import {
  type ClienteScryfall,
  criarClienteScryfall,
  type OpcoesDoClienteScryfall,
} from '../../../../src/modules/catalogo/scryfall/cliente-scryfall.js';
import { type ClienteRedisComCatalogo, criarClienteRedis } from '../../../../src/redis/cliente.js';
import { criarConexaoDoRedis } from '../../../../src/redis/conexao.js';
import {
  ID_CARTA_DUPLA_FACE,
  ID_CARTA_SEM_IMAGEM,
  ID_CARTA_SIMPLES,
} from '../../../helpers/fixtures-scryfall/cartas.js';
import { portaFechada } from '../../../helpers/porta-fechada.js';
import { iniciarScryfallFalsa, type ScryfallFalsa } from '../../../helpers/scryfall-falsa.js';
import { ambienteDoRedis } from '../../../redis/ambiente-de-teste.js';

const ambiente = ambienteDoRedis(process.env);
const USER_AGENT = 'LeilaoVerzel/teste-054';
const ID_INEXISTENTE = '00000000-0000-4000-8000-000000000000';
const DIA_MS = 24 * 3_600_000;
/** Tolerância de agendamento ao medir intervalos entre requisições (nota da 052). */
const JITTER_MS = 30;

function sha1(texto: string): string {
  return createHash('sha1').update(texto).digest('hex');
}

async function falhaDe(promessa: Promise<unknown>): Promise<ErroApi> {
  const falha = await promessa.then(
    () => undefined,
    (erro: unknown) => erro,
  );
  expect(falha).toBeInstanceOf(ErroApi);
  return falha as ErroApi;
}

/** A mensagem, os detalhes e a pilha não levam URL, host nem porta do upstream. */
function semVazamento(erro: ErroApi, falsa: ScryfallFalsa): void {
  const texto = `${erro.message} ${JSON.stringify(erro.detalhes ?? {})} ${String(erro.stack)}`;
  expect(texto).not.toContain(falsa.host);
  expect(texto).not.toContain(String(falsa.porta));
  expect(texto).not.toContain('http');
  expect(erro).not.toHaveProperty('cause');
}

describe.skipIf(!ambiente.disponivel)('cliente da Scryfall (Redis real, Scryfall falsa)', () => {
  let redis: ClienteRedisComCatalogo;
  let falsa: ScryfallFalsa;
  let prefixo = '';

  function cliente(opcoes: Partial<OpcoesDoClienteScryfall> = {}): ClienteScryfall {
    return criarClienteScryfall({
      redis,
      config: { userAgent: USER_AGENT, baseUrl: falsa.url },
      prefixo,
      ...opcoes,
    });
  }

  beforeAll(async () => {
    redis = criarClienteRedis({ conexao: ambiente.conexao(), aoErro: () => undefined });
    await redis.aguardarConexao(AbortSignal.timeout(2_000));
    falsa = await iniciarScryfallFalsa({ atrasoLentoMs: 1_000 });
  });

  afterAll(async () => {
    await falsa.fechar();
    await redis.encerrar();
  });

  beforeEach(() => {
    falsa.definirModo('ok');
    falsa.zerar();
    prefixo = `teste:054:${randomBytes(6).toString('hex')}:scryfall:`;
  });

  describe('busca', () => {
    it('envia User-Agent, Accept, unique=cards, order=name e page; projeta as cartas', async () => {
      const pagina = await cliente().buscar('Lightning Bolt', 1);

      const [req] = falsa.requisicoes();
      expect(req?.userAgent).toBe(USER_AGENT);
      expect(req?.accept).toBe('application/json');
      const url = new URL(req?.caminho ?? '', 'http://x');
      expect(url.pathname).toBe('/cards/search');
      expect(Object.fromEntries(url.searchParams)).toEqual({
        q: 'Lightning Bolt',
        page: '1',
        unique: 'cards',
        order: 'name',
      });
      expect(pagina.total).toBe(1);
      // A fixture da 052 só tem image_uris.normal; a projeção do `small` está em projecao.test.ts.
      expect(pagina.cartas).toEqual([
        {
          scryfallId: ID_CARTA_SIMPLES,
          nome: 'Lightning Bolt',
          colecao: 'Conjunto de Teste',
          raridade: 'common',
          tipo: 'Instant',
          artista: 'Artista de Teste',
          imagemUrl: null,
        },
      ]);
    });

    it('a página Scryfall pedida vai no parâmetro page e a lista tem até 175 cartas', async () => {
      const pagina = await cliente().buscar('a', 2);

      expect(
        new URL(falsa.requisicoes()[0]?.caminho ?? '', 'http://x').searchParams.get('page'),
      ).toBe('2');
      expect(pagina.total).toBeGreaterThan(175);
      expect(pagina.cartas.length).toBeGreaterThan(0);
      expect(pagina.cartas.length).toBeLessThanOrEqual(175);
    });

    it('404 da Scryfall vira lista vazia com total 0, e também vai para o cache', async () => {
      const c = cliente();

      expect(await c.buscar('zzz-nada-casa', 1)).toEqual({ total: 0, cartas: [] });
      expect(await c.buscar('zzz-nada-casa', 1)).toEqual({ total: 0, cartas: [] });

      expect(falsa.requisicoes()).toHaveLength(1);
    });

    it('400 da Scryfall (sintaxe recusada) vira 422 DADOS_INVALIDOS com campo q', async () => {
      const erro = await falhaDe(cliente().buscar('', 1));

      expect(erro).toMatchObject({ status: 422, codigo: 'DADOS_INVALIDOS' });
      expect(erro.detalhes).toEqual({ campo: 'q' });
    });

    it('cache hit não chama o upstream e responde em menos de 50 ms', async () => {
      const c = cliente();
      const primeira = await c.buscar('bolt', 1);
      falsa.zerar();

      const inicio = performance.now();
      const segunda = await c.buscar('bolt', 1);

      expect(performance.now() - inicio).toBeLessThan(50);
      expect(segunda).toEqual(primeira);
      expect(falsa.requisicoes()).toHaveLength(0);
      const ttl = await redis.ttlRestanteMs(`${prefixo}busca:${sha1('bolt')}:1`);
      expect(ttl).toBeGreaterThan(DIA_MS - 60_000);
    });

    it('cache hit responde mesmo com o circuito aberto', async () => {
      const c = cliente();
      await c.buscar('bolt', 2);
      await redis.gravarComTtl(`${prefixo}circuito`, '1', 30_000);
      falsa.zerar();

      await expect(c.buscar('bolt', 2)).resolves.toMatchObject({ total: expect.any(Number) });
      expect(falsa.requisicoes()).toHaveLength(0);
    });
  });

  describe('circuito', () => {
    it('um 429 abre o circuito por 30 s: 503 INDISPONIVEL sem nova chamada', async () => {
      const c = cliente();
      falsa.definirModo('bloqueada');

      const primeiro = await falhaDe(c.buscar('a', 1));
      expect(primeiro).toMatchObject({ status: 503, codigo: 'CATALOGO_INDISPONIVEL' });
      expect(falsa.requisicoes()).toHaveLength(1); // 429 não tem retry
      const ttl = await redis.ttlRestanteMs(`${prefixo}circuito`);
      expect(ttl).toBeGreaterThan(29_000);
      expect(ttl).toBeLessThanOrEqual(30_000);

      falsa.zerar();
      const segundo = await falhaDe(c.buscar('b', 1));
      expect(segundo).toMatchObject({ status: 503, codigo: 'CATALOGO_INDISPONIVEL' });
      const espera = segundo.detalhes?.['tenteNovamenteEm'];
      expect(espera).toBeGreaterThanOrEqual(1);
      expect(espera).toBeLessThanOrEqual(30);
      expect(segundo.retryAfterSegundos).toBe(espera);
      expect(falsa.requisicoes()).toHaveLength(0);
      semVazamento(segundo, falsa);
    });

    it('depois do tempo de abertura, o circuito fecha e a chamada volta ao upstream', async () => {
      const c = cliente({ tempos: { circuitoMs: 300 } });
      falsa.definirModo('429');
      await falhaDe(c.buscar('a', 1));
      await falhaDe(c.buscar('b', 1));
      expect(falsa.requisicoes()).toHaveLength(1);

      await new Promise((resolver) => setTimeout(resolver, 400));

      await expect(c.buscar('c', 1)).resolves.toMatchObject({ total: expect.any(Number) });
      expect(falsa.requisicoes()).toHaveLength(2);
    });

    it('5 falhas seguidas (5xx depois do retry) abrem o circuito', async () => {
      const c = cliente();
      falsa.definirModo('5xx');

      for (let i = 0; i < 5; i += 1) {
        const erro = await falhaDe(c.obterCarta(ID_CARTA_SIMPLES));
        expect(erro.codigo).toBe('CATALOGO_INDISPONIVEL');
      }
      expect(falsa.requisicoes()).toHaveLength(10);
      expect(await redis.ttlRestanteMs(`${prefixo}circuito`)).toBeGreaterThan(29_000);

      falsa.zerar();
      await falhaDe(c.obterCarta(ID_CARTA_SIMPLES));
      expect(falsa.requisicoes()).toHaveLength(0);
    });

    it('um sucesso entre as falhas zera a contagem', async () => {
      const c = cliente();
      for (const rodada of [4, 4]) {
        falsa.definirModo('5xx');
        for (let i = 0; i < rodada; i += 1) await falhaDe(c.obterCarta(ID_CARTA_SIMPLES));
        falsa.definirModo('ok');
        await c.obterCarta(ID_INEXISTENTE);
      }

      expect(await redis.ttlRestanteMs(`${prefixo}circuito`)).toBe(-2);
    });
  });

  describe('retry', () => {
    it('5xx que falha uma vez: exatamente 2 requisições e sucesso', async () => {
      falsa.definirModo('5xx', { vezes: 1 });

      const carta = await cliente().obterCarta(ID_CARTA_SIMPLES);

      expect(carta?.['id']).toBe(ID_CARTA_SIMPLES);
      expect(falsa.requisicoes()).toHaveLength(2);
    });

    it('5xx persistente: 2 requisições e 503 INDISPONIVEL com tenteNovamenteEm 5', async () => {
      falsa.definirModo('5xx');

      const erro = await falhaDe(cliente().obterCarta(ID_CARTA_SIMPLES));

      expect(erro).toMatchObject({ status: 503, codigo: 'CATALOGO_INDISPONIVEL' });
      expect(erro.detalhes).toEqual({ tenteNovamenteEm: 5 });
      expect(erro.retryAfterSegundos).toBe(5);
      expect(falsa.requisicoes()).toHaveLength(2);
      semVazamento(erro, falsa);
    });

    it('timeout: 1 retry e 503, sem levar URL na mensagem', async () => {
      falsa.definirModo('lento');

      const erro = await falhaDe(
        cliente({ tempos: { timeoutMs: 150 } }).obterCarta(ID_CARTA_SIMPLES),
      );

      expect(erro.codigo).toBe('CATALOGO_INDISPONIVEL');
      expect(falsa.requisicoes()).toHaveLength(2);
      semVazamento(erro, falsa);
    });

    it('erro de rede: 1 retry e 503', async () => {
      falsa.definirModo('fora');

      const erro = await falhaDe(cliente().obterCarta(ID_CARTA_SIMPLES));

      expect(erro.codigo).toBe('CATALOGO_INDISPONIVEL');
      expect(falsa.requisicoes()).toHaveLength(2);
      semVazamento(erro, falsa);
    });
  });

  describe('carta', () => {
    it('obterCarta devolve o JSON da carta e guarda no cache por 24 h', async () => {
      const c = cliente();
      const carta = await c.obterCarta(ID_CARTA_DUPLA_FACE);
      falsa.zerar();

      expect(await c.obterCarta(ID_CARTA_DUPLA_FACE)).toEqual(carta);
      expect(falsa.requisicoes()).toHaveLength(0);
      expect(carta?.['card_faces']).toEqual(expect.any(Array));
      const ttl = await redis.ttlRestanteMs(`${prefixo}carta:${ID_CARTA_DUPLA_FACE}`);
      expect(ttl).toBeGreaterThan(DIA_MS - 60_000);
    });

    it('carta inexistente (404) devolve null', async () => {
      expect(await cliente().obterCarta(ID_INEXISTENTE)).toBeNull();
    });

    it('id que não é UUID → 422 com campo scryfallId, sem chamar o upstream', async () => {
      const erro = await falhaDe(cliente().obterCarta('../cards/search'));

      expect(erro).toMatchObject({ status: 422, codigo: 'DADOS_INVALIDOS' });
      expect(erro.detalhes).toEqual({ campo: 'scryfallId' });
      expect(falsa.requisicoes()).toHaveLength(0);
    });
  });

  describe('token bucket', () => {
    it('20 buscas simultâneas: nenhuma janela de 1 s com mais de 2 em /cards/search', async () => {
      const c = cliente();
      const inicio = performance.now();

      const resultados = await Promise.allSettled(
        Array.from({ length: 20 }, (_, i) => c.buscar(`carta-${i}`, 1)),
      );

      expect(performance.now() - inicio).toBeLessThan(2_500);
      const instantes = falsa
        .requisicoes()
        .filter((r) => r.caminho.startsWith('/cards/search'))
        .map((r) => r.instanteMs);
      for (let i = 2; i < instantes.length; i += 1) {
        const janela = (instantes[i] ?? 0) - (instantes[i - 2] ?? 0);
        expect(janela).toBeGreaterThanOrEqual(1_000 - JITTER_MS);
      }
      const recusadas = resultados.flatMap((r) =>
        r.status === 'rejected' ? [r.reason as ErroApi] : [],
      );
      expect(recusadas.length).toBeGreaterThanOrEqual(20 - 3);
      expect(instantes).toHaveLength(20 - recusadas.length);
      for (const erro of recusadas) {
        expect(erro).toMatchObject({ status: 503, codigo: 'CATALOGO_OCUPADO' });
        expect(erro.detalhes).toEqual({ tenteNovamenteEm: 1 });
        expect(erro.retryAfterSegundos).toBe(1);
      }
    });

    it('obterCarta usa o bucket default (10/s): intervalo mínimo de 100 ms', async () => {
      const c = cliente();
      const ids = [ID_CARTA_SIMPLES, ID_CARTA_DUPLA_FACE, ID_CARTA_SEM_IMAGEM];

      await Promise.all(ids.map((id) => c.obterCarta(id)));

      const instantes = falsa.requisicoes().map((r) => r.instanteMs);
      expect(instantes).toHaveLength(3);
      for (let i = 1; i < instantes.length; i += 1) {
        const intervalo = (instantes[i] ?? 0) - (instantes[i - 1] ?? 0);
        expect(intervalo).toBeGreaterThanOrEqual(100 - JITTER_MS);
      }
    });

    it('circuito aberto não consome ficha do bucket', async () => {
      await redis.gravarComTtl(`${prefixo}circuito`, '1', 30_000);

      await falhaDe(cliente().buscar('a', 1));

      expect(await redis.obter(`${prefixo}bucket:search`)).toBeNull();
    });
  });
});

describe('cliente da Scryfall com o Redis fora', () => {
  it('503 CATALOGO_INDISPONIVEL com tenteNovamenteEm 5, sem chamar a Scryfall', async () => {
    const falsa = await iniciarScryfallFalsa();
    const porta = await portaFechada();
    const redis = criarClienteRedis({
      conexao: criarConexaoDoRedis(
        { host: '127.0.0.1', port: porta },
        randomBytes(32).toString('base64url'),
      ),
      aoErro: () => undefined,
    });
    try {
      const c = criarClienteScryfall({
        redis,
        config: { userAgent: USER_AGENT, baseUrl: falsa.url },
      });

      for (const chamada of [c.buscar('a', 1), c.obterCarta(ID_CARTA_SIMPLES)]) {
        const erro = await falhaDe(chamada);
        expect(erro).toMatchObject({ status: 503, codigo: 'CATALOGO_INDISPONIVEL' });
        expect(erro.detalhes).toEqual({ tenteNovamenteEm: 5 });
        expect(erro.message).not.toContain(String(porta));
      }
      expect(falsa.requisicoes()).toHaveLength(0);
    } finally {
      await redis.encerrar();
      await falsa.fechar();
    }
  });
});
