// QA (tarefa 062): critérios de aceite de specs/006 que não dependem da F4, provados pela API HTTP
// real (Postgres e Redis reais, Scryfall falsa): cancelado some da vitrine e segue no painel,
// filtros combinados, `suaPosicao`, sessão expirada, entrada hostil e privacidade das respostas
// públicas. Lotes entram por SQL; o status gravado é alterado por SQL (o cancelamento com estorno é
// da F4). Toda resposta HTTP é validada contra o openapi.yaml pelo `criarAppDeTeste`.
import { randomBytes, randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { LightMyRequestResponse } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { emitirAccessToken } from '../../src/modules/identidade/tokens.js';
import { apagarChavesDoPrefixo, clienteDeTeste } from '../common/limite/redis-de-teste.js';
import {
  apagarChavesDaScryfall,
  criarAppDeTeste,
  novoPrefixoDaScryfall,
} from '../helpers/app-de-teste.js';
import {
  apagarLotesEUsuarios,
  type ContaPorSql,
  inserirLote,
  inserirUsuario,
  iso,
  type ValorDeColuna,
} from '../helpers/lotes-por-sql.js';
import { iniciarScryfallFalsa, type ScryfallFalsa } from '../helpers/scryfall-falsa.js';
import {
  BANCO,
  CHAVE_JWT,
  envReal,
  INFRA_DISPONIVEL,
  REDIS,
} from '../modules/identidade/ambiente.js';

type Papel = 'leiloeiro' | 'licitante';
type Cabecalhos = Readonly<Record<string, string>>;
type Conta = ContaPorSql & { readonly cabecalhos: Cabecalhos };

interface LoteDaResposta {
  readonly id: string;
  readonly status: string;
  readonly precoAtualCentavos: number;
}

interface Pagina {
  readonly dados: LoteDaResposta[];
  readonly meta: { total: number; pagina: number; limite: number };
}

const CSRF = 'csrf-de-teste-dos-lotes';
const HORA = 60 * 60 * 1000;
const MENOS_UMA_HORA = -HORA;
const NOME_MINIMO_PARA_VARREDURA = 8;

const novaTag = (): string => `zq${randomBytes(6).toString('hex')}`;

describe.skipIf(!INFRA_DISPONIVEL)('integração de lotes (specs/006)', () => {
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

  afterAll(async () => {
    await apagarLotesEUsuarios(pool, usuarios);
    await pool.end();
    await apagarChavesDaScryfall(redis, prefixoDaScryfall);
    await apagarChavesDoPrefixo(redis, prefixoDoLimite);
    redis.destroy();
    await app.close();
    await scryfall.fechar();
  });

  async function conta(papel: Papel, emitidoEm?: Date): Promise<Conta> {
    const criada = await inserirUsuario(pool, papel);
    usuarios.push(criada.id);
    const token = await emitirAccessToken(CHAVE_JWT, { id: criada.id, papel }, emitidoEm);
    return {
      ...criada,
      cabecalhos: { cookie: `access_token=${token}; csrf_token=${CSRF}`, 'x-csrf-token': CSRF },
    };
  }

  const lote = (extra: Readonly<Record<string, ValorDeColuna>> = {}) =>
    inserirLote(pool, leiloeiro.id, extra);

  function get(url: string, headers: Cabecalhos = {}): Promise<LightMyRequestResponse> {
    return app.inject({ method: 'GET', url, headers });
  }

  async function vitrine(parametros: Readonly<Record<string, string>>): Promise<Pagina> {
    const resposta = await get(`/api/lotes?${new URLSearchParams(parametros).toString()}`);
    expect(resposta.statusCode, resposta.body).toBe(200);
    return resposta.json<Pagina>();
  }

  it('lote cancelado (status gravado alterado por SQL) some da vitrine e segue no painel', async () => {
    const dono = await conta('leiloeiro');
    const tag = novaTag();
    const { id } = await inserirLote(pool, dono.id, { titulo: tag });
    expect((await vitrine({ q: tag })).dados.map((l) => l.id)).toEqual([id]);

    await pool.query(`update lots set status = 'cancelado' where id = $1`, [id]);

    expect((await vitrine({ q: tag })).dados).toEqual([]);
    const detalhe = await get(`/api/lotes/${id}`);
    expect(detalhe.statusCode).toBe(200);
    expect(detalhe.json()).toMatchObject({ dados: { id, status: 'cancelado' } });
    const painel = await get('/api/painel/lotes', dono.cabecalhos);
    expect(painel.statusCode).toBe(200);
    expect(painel.json<Pagina>().dados.map((l) => [l.id, l.status])).toEqual([[id, 'cancelado']]);
  });

  it('filtros combinados (status, texto, preço, raridade, ordem) devolvem o conjunto exato', async () => {
    const tag = novaTag();
    const agora = Date.now();
    const base = { titulo: `${tag} alvo`, raridade: 'rare', lance_inicial_centavos: 4000 };
    const caro = await lote(base);
    const comLance = await lote({
      ...base,
      lance_inicial_centavos: 1000,
      lance_atual_centavos: 3000,
      total_lances: 2,
    });
    // Cada lote abaixo falha em exatamente um filtro.
    await lote({ ...base, raridade: 'common' });
    await lote({ ...base, lance_inicial_centavos: 9000 });
    await lote({ ...base, titulo: `${tag} fora` });
    await lote({
      ...base,
      status: 'agendado',
      inicio_em: iso(agora + HORA),
      fim_em: iso(agora + 2 * HORA),
    });
    await lote({ ...base, status: 'cancelado' });

    const pagina = await vitrine({
      status: 'ao_vivo',
      q: `${tag} alvo`,
      precoMin: '2500',
      precoMax: '5000',
      raridade: 'rare',
      ordem: 'maior_lance',
    });

    expect(pagina.dados.map((l) => [l.id, l.precoAtualCentavos])).toEqual([
      [caro.id, 4000],
      [comLance.id, 3000],
    ]);
    expect(pagina.meta.total).toBe(2);
  });

  it('suaPosicao: ganhando, venceu e null para os demais, inclusive anônimo', async () => {
    const lider = await conta('licitante');
    const vencedor = await conta('licitante');
    const outro = await conta('licitante');
    const aoVivo = await lote({ lider_id: lider.id, lance_atual_centavos: 500, total_lances: 1 });
    const encerrado = await lote({
      status: 'encerrado',
      inicio_em: iso(Date.now() - 2 * HORA),
      fim_em: iso(Date.now() + MENOS_UMA_HORA),
      lider_id: vencedor.id,
      vencedor_id: vencedor.id,
      lance_atual_centavos: 700,
      valor_arremate_centavos: 700,
      total_lances: 1,
    });

    const posicao = async (id: string, quem?: Conta): Promise<unknown> => {
      const resposta = await get(`/api/lotes/${id}`, quem?.cabecalhos ?? {});
      expect(resposta.statusCode, resposta.body).toBe(200);
      return resposta.json<{ dados: { suaPosicao: unknown } }>().dados.suaPosicao;
    };

    expect(await posicao(aoVivo.id, lider)).toBe('ganhando');
    expect(await posicao(encerrado.id, vencedor)).toBe('venceu');
    expect(await posicao(aoVivo.id, outro)).toBeNull();
    expect(await posicao(encerrado.id, lider)).toBeNull();
    expect(await posicao(aoVivo.id)).toBeNull();
    expect(await posicao(encerrado.id)).toBeNull();
  });

  it('detalhe com JWT assinado e expirado responde 200 como anônimo', async () => {
    const lider = await conta('licitante', new Date(Date.now() + 2 * MENOS_UMA_HORA));
    const { id } = await lote({ lider_id: lider.id, lance_atual_centavos: 500, total_lances: 1 });

    const resposta = await get(`/api/lotes/${id}`, lider.cabecalhos);

    expect(resposta.statusCode, resposta.body).toBe(200);
    expect(resposta.json()).toMatchObject({ dados: { id, suaPosicao: null } });
  });

  // Hardening da F5 (tmp/hardening-f5.md): hoje `q` com NUL chega ao Postgres e vira 500. Quando o
  // código de produção rejeitar com 422, este it.fails passa a falhar: troque por `it`.
  it.fails('?q=%00 na vitrine responde 422 DADOS_INVALIDOS com detalhes.campo q', async () => {
    const resposta = await get('/api/lotes?q=%00');

    expect(resposta.statusCode).toBe(422);
    expect(resposta.json()).toMatchObject({
      erro: { codigo: 'DADOS_INVALIDOS', detalhes: { campo: 'q' } },
    });
  });

  it('nenhuma resposta pública contém nome ou e-mail de usuário', async () => {
    const lider = await conta('licitante');
    const vencedor = await conta('licitante');
    const tag = novaTag();
    const aoVivo = await lote({
      titulo: tag,
      lider_id: lider.id,
      lance_atual_centavos: 500,
      total_lances: 1,
    });
    const encerrado = await lote({
      titulo: tag,
      status: 'encerrado',
      inicio_em: iso(Date.now() - 2 * HORA),
      fim_em: iso(Date.now() + MENOS_UMA_HORA),
      lider_id: vencedor.id,
      vencedor_id: vencedor.id,
      lance_atual_centavos: 700,
      valor_arremate_centavos: 700,
      total_lances: 1,
    });
    // Todos os usuários do banco (semeados e de teste): e-mails sempre; nomes só os não triviais.
    const { rows } = await pool.query<{ nome: string; email: string }>(
      'select nome, email from users',
    );
    const segredos = rows
      .flatMap((u) => [u.email, u.nome])
      .filter((v) => v.includes('@') || v.length >= NOME_MINIMO_PARA_VARREDURA);
    expect(segredos.length).toBeGreaterThan(0);

    const respostas = [
      await get(`/api/lotes?q=${tag}`),
      await get(`/api/lotes?q=${tag}&status=encerrado`),
      await get(`/api/lotes/${aoVivo.id}`),
      await get(`/api/lotes/${aoVivo.id}`, lider.cabecalhos),
      await get(`/api/lotes/${encerrado.id}`, vencedor.cabecalhos),
      await get(`/api/lotes/${encerrado.id}`, leiloeiro.cabecalhos),
    ];

    for (const resposta of respostas) {
      expect(resposta.statusCode, resposta.body).toBe(200);
      for (const segredo of segredos) {
        expect(resposta.body).not.toContain(segredo);
      }
    }
  });
});
