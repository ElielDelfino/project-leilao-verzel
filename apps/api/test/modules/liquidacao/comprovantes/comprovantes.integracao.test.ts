// Integração (Postgres e Redis reais): GET /api/comprovantes/{codigo} e GET /api/me/arremates
// (tarefa 109; specs/011 §Interfaces e contratos). Toda resposta é validada contra o openapi pelo
// app de teste. Recibos são semeados por SQL; cada cenário tem o próprio leiloeiro e os próprios
// licitantes (`receipts` é append-only e os arquivos de teste rodam em paralelo no mesmo banco).
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { inserirUsuario } from '../../../helpers/lotes-por-sql.js';
import {
  type AppDeIdentidade,
  BANCO,
  cadastrar,
  criarAppDeIdentidade,
  INFRA_DISPONIVEL,
  Navegador,
} from '../../identidade/ambiente.js';
import { codigoNovo, semearRecibo } from './apoio-de-comprovantes.js';

const TIMEOUT_LONGO_MS = 60_000;
const POR_PAGINA = 24;
const HORA_MS = 60 * 60 * 1000;
const FORMATO_DO_CODIGO = /^[0-9A-Za-z]{16}$/;
const CAMPOS_DO_COMPROVANTE = [
  'assinaturaSelo',
  'auditoriaUrl',
  'carta',
  'codigo',
  'emitidoEm',
  'hashFinal',
  'keyId',
  'seladoEm',
  'valorCentavos',
  'vencedorPseudonimo',
];
const CAMPOS_DO_ARREMATE = ['auditoriaUrl', 'carta', 'codigo', 'emitidoEm', 'valorCentavos'];

interface Conta {
  readonly navegador: Navegador;
  readonly id: string;
  readonly nome: string;
  readonly email: string;
}

describe.skipIf(!INFRA_DISPONIVEL)('comprovante e meus arremates (Postgres e Redis reais)', () => {
  let ctx: AppDeIdentidade;
  let pool: pg.Pool;
  let leiloeiroId: string;
  let ipSeguinte = 1;

  beforeAll(async () => {
    ctx = await criarAppDeIdentidade();
    pool = new pg.Pool(BANCO.conexao());
    leiloeiroId = (await inserirUsuario(pool, 'leiloeiro')).id;
  }, TIMEOUT_LONGO_MS);

  afterAll(async () => {
    await pool.end();
    await ctx.fechar();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function conta(papel: 'licitante' | 'leiloeiro' = 'licitante'): Promise<Conta> {
    const navegador = new Navegador(ctx.app, `10.109.0.${ipSeguinte++ % 250}`);
    const { email, resposta } = await cadastrar(navegador, { papel });
    expect(resposta.statusCode).toBe(201);
    const { rows } = await pool.query<{ id: string; nome: string }>(
      'select id, nome from users where email = $1',
      [email],
    );
    const linha = rows[0];
    if (linha === undefined) throw new Error('usuário cadastrado não encontrado');
    return { navegador, id: linha.id, nome: linha.nome, email };
  }

  const anonimo = (): Navegador => new Navegador(ctx.app, `10.109.1.${ipSeguinte++ % 250}`);

  function semNomeNemEmail(corpo: string, quem: readonly Conta[]): void {
    for (const c of quem) {
      expect(corpo).not.toContain(c.nome);
      expect(corpo).not.toContain(c.email);
      expect(corpo).not.toContain(c.id);
    }
    expect(corpo).not.toMatch(/vencedorId|vencedor_id|lider|email|"nome":\s*"Conta/);
  }

  describe('GET /api/comprovantes/{codigo}', () => {
    it('devolve o comprovante público, sem dados pessoais, sem cache e sem a Scryfall', async () => {
      const vencedor = await conta();
      const recibo = await semearRecibo(pool, {
        leiloeiroId,
        vencedorId: vencedor.id,
        valorCentavos: 16_500,
        emitidoEm: Date.now() - HORA_MS,
      });
      const fetchEspiao = vi.spyOn(globalThis, 'fetch');

      const resposta = await anonimo().get(`/api/comprovantes/${recibo.codigo}`);

      expect(resposta.statusCode).toBe(200);
      expect(resposta.headers['cache-control']).toBe('no-store');
      const { sucesso, dados } = resposta.json<{
        sucesso: boolean;
        dados: Record<string, unknown>;
      }>();
      expect(sucesso).toBe(true);
      expect(Object.keys(dados).sort()).toEqual(CAMPOS_DO_COMPROVANTE);
      expect(dados).toMatchObject({
        codigo: recibo.codigo,
        vencedorPseudonimo: 'Licitante #3fa9c1',
        valorCentavos: 16_500,
        carta: { nome: 'Black Lotus', imagemUrl: `/api/imagens/${recibo.snapshotId}` },
        hashFinal: recibo.hashFinalHex,
        assinaturaSelo: recibo.assinaturaBase64url,
        keyId: recibo.keyId,
        auditoriaUrl: `/auditoria/${recibo.loteId}`,
      });
      semNomeNemEmail(resposta.body, [vencedor]);
      expect(resposta.body).not.toContain(leiloeiroId);
      expect(fetchEspiao.mock.calls.map(([alvo]) => String(alvo)).join(' ')).not.toMatch(
        /scryfall/i,
      );
    });

    it('código inexistente e malformado dão o mesmo 404, sem cache', async () => {
      const inexistente = codigoNovo();
      const malformados = [
        'curto',
        `${inexistente}x`,
        'abc-def-ghi-jklm',
        '%20%20%20%20%20%20%20%20',
      ];

      const resposta404 = await anonimo().get(`/api/comprovantes/${inexistente}`);
      const respostas = await Promise.all(
        malformados.map((m) => anonimo().get(`/api/comprovantes/${m}`)),
      );

      expect(resposta404.statusCode).toBe(404);
      expect(resposta404.headers['cache-control']).toBe('no-store');
      for (const r of respostas) {
        expect(r.statusCode).toBe(404);
        expect(r.headers['cache-control']).toBe('no-store');
        expect(r.json()).toEqual(resposta404.json());
      }
    });

    it('o código errado de outro recibo não revela o dono: 404 sem pista', async () => {
      const dono = await conta();
      const outro = await conta();
      const recibo = await semearRecibo(pool, {
        leiloeiroId,
        vencedorId: dono.id,
        valorCentavos: 500,
        emitidoEm: Date.now(),
      });
      const adulterado = `${recibo.codigo.slice(0, 15)}${recibo.codigo.endsWith('A') ? 'B' : 'A'}`;

      const resposta = await outro.navegador.get(`/api/comprovantes/${adulterado}`);

      expect(resposta.statusCode).toBe(404);
      expect(resposta.body).not.toContain(recibo.loteId);
    });
  });

  describe('GET /api/me/arremates', () => {
    it('lista só os recibos do próprio usuário, do mais recente ao mais antigo', async () => {
      const a = await conta();
      const b = await conta();
      const antigo = await semearRecibo(pool, {
        leiloeiroId,
        vencedorId: a.id,
        valorCentavos: 100,
        emitidoEm: Date.now() - 3 * HORA_MS,
      });
      const recente = await semearRecibo(pool, {
        leiloeiroId,
        vencedorId: a.id,
        valorCentavos: 300,
        emitidoEm: Date.now() - HORA_MS,
      });
      const deOutro = await semearRecibo(pool, {
        leiloeiroId,
        vencedorId: b.id,
        valorCentavos: 900,
        emitidoEm: Date.now(),
      });
      const fetchEspiao = vi.spyOn(globalThis, 'fetch');

      const resposta = await a.navegador.get('/api/me/arremates');

      expect(resposta.statusCode).toBe(200);
      expect(resposta.headers['cache-control']).toBe('no-store');
      const corpo = resposta.json<{
        dados: Record<string, unknown>[];
        meta: Record<string, number>;
      }>();
      expect(corpo.dados.map((d) => d['codigo'])).toEqual([recente.codigo, antigo.codigo]);
      expect(corpo.meta).toEqual({ total: 2, pagina: 1, limite: POR_PAGINA });
      for (const item of corpo.dados) {
        expect(Object.keys(item).sort()).toEqual(CAMPOS_DO_ARREMATE);
        expect(item['carta']).toMatchObject({ nome: 'Black Lotus' });
      }
      expect(corpo.dados[0]).toMatchObject({
        valorCentavos: 300,
        auditoriaUrl: `/auditoria/${recente.loteId}`,
      });
      expect(resposta.body).not.toContain(deOutro.codigo);
      semNomeNemEmail(resposta.body, [a, b]);
      expect(fetchEspiao.mock.calls.map(([alvo]) => String(alvo)).join(' ')).not.toMatch(
        /scryfall/i,
      );
    });

    it(
      'pagina de 24 em 24, com total real e lista vazia além da última',
      async () => {
        const a = await conta();
        const base = Date.now() - 100 * HORA_MS;
        const codigos: string[] = [];
        for (let i = 0; i < POR_PAGINA + 1; i += 1) {
          const recibo = await semearRecibo(pool, {
            leiloeiroId,
            vencedorId: a.id,
            valorCentavos: 100 + i,
            emitidoEm: base + i * 1000,
          });
          codigos.push(recibo.codigo);
        }
        const maisRecenteAoMaisAntigo = [...codigos].reverse();

        const primeira = (await a.navegador.get('/api/me/arremates?pagina=1')).json<{
          dados: { codigo: string }[];
          meta: unknown;
        }>();
        const segunda = (await a.navegador.get('/api/me/arremates?pagina=2')).json<{
          dados: { codigo: string }[];
        }>();
        const alem = (await a.navegador.get('/api/me/arremates?pagina=3')).json<{
          dados: unknown[];
          meta: unknown;
        }>();

        expect(primeira.dados.map((d) => d.codigo)).toEqual(
          maisRecenteAoMaisAntigo.slice(0, POR_PAGINA),
        );
        expect(primeira.meta).toEqual({ total: POR_PAGINA + 1, pagina: 1, limite: POR_PAGINA });
        expect(segunda.dados.map((d) => d.codigo)).toEqual(
          maisRecenteAoMaisAntigo.slice(POR_PAGINA),
        );
        expect(alem.dados).toEqual([]);
        expect(alem.meta).toEqual({ total: POR_PAGINA + 1, pagina: 3, limite: POR_PAGINA });
      },
      TIMEOUT_LONGO_MS,
    );

    it.each(['0', '501', 'abc', '1.5', '-1'])('pagina=%s → 422 DADOS_INVALIDOS', async (pagina) => {
      const a = await conta();

      const resposta = await a.navegador.get(`/api/me/arremates?pagina=${pagina}`);

      expect(resposta.statusCode).toBe(422);
      expect(resposta.headers['cache-control']).toBe('no-store');
      expect(resposta.json()).toMatchObject({ erro: { codigo: 'DADOS_INVALIDOS' } });
    });

    it('leiloeiro recebe 403 e anônimo recebe 401', async () => {
      const dono = await conta('leiloeiro');

      const doLeiloeiro = await dono.navegador.get('/api/me/arremates');
      const doAnonimo = await anonimo().get('/api/me/arremates');

      expect(doLeiloeiro.statusCode).toBe(403);
      expect(doLeiloeiro.json()).toMatchObject({ erro: { codigo: 'PAPEL_NAO_PERMITIDO' } });
      expect(doAnonimo.statusCode).toBe(401);
      expect(FORMATO_DO_CODIGO.test('0123456789abcdEF')).toBe(true);
    });
  });
});
