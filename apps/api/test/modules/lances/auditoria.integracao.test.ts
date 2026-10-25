// Integração (Postgres e Redis reais): GET /api/auditoria/lotes/{id} e GET /api/auditoria/chaves
// (tarefa 081; specs/008 §Verificação e §Interfaces e contratos, specs/011, ADR 0031 D7). Toda
// resposta é validada contra o openapi pelo app de teste. A cadeia é semeada com
// `CadeiaDeLances.anexar`/`selar` (assinada de verdade) e o estado de `lots` por SQL. A adulteração
// desliga o trigger append-only só dentro de uma transação do próprio teste.
import { randomBytes, randomUUID } from 'node:crypto';

import type { LightMyRequestResponse } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BANCO as TOKEN_DO_BANCO } from '../../../src/config/banco.module.js';
import type { Banco } from '../../../src/db/banco.js';
import { CadeiaDeLances, registrarChaveDeAssinatura } from '../../../src/modules/lances/index.js';
import { derivarChaves } from '../../../src/modules/lances/integridade/assinatura.js';
import { hashGenese } from '../../../src/modules/lances/integridade/hash.js';
import { estadoDoLote } from '../../helpers/lances-por-sql.js';
import { inserirLote, inserirUsuario } from '../../helpers/lotes-por-sql.js';
import {
  type AppDeIdentidade,
  BANCO,
  criarAppDeIdentidade,
  INFRA_DISPONIVEL,
} from '../identidade/ambiente.js';

const HORA = 60 * 60 * 1000;
const UUID_INEXISTENTE = '0192f000-0000-7000-8000-00000000dead';

interface Conta {
  readonly id: string;
  readonly nome: string;
  readonly email: string;
}

interface LanceJson {
  readonly seq: number;
  readonly pseudonimo: string;
  readonly valorCentavos: number;
  readonly hashAnterior: string;
  readonly hash: string;
  readonly keyId: string;
}

interface AuditoriaJson {
  readonly lote: Record<string, unknown> & { readonly id: string; readonly totalLances: number };
  readonly lances: readonly LanceJson[];
  readonly selo: (Record<string, unknown> & { readonly hashFinal: string }) | null;
  readonly veredito: 'integro' | 'adulterado';
  readonly problemas: readonly { codigo: string; seq: number | null; mensagem: string }[];
}

interface ChaveJson {
  readonly keyId: string;
  readonly algoritmo: string;
  readonly chavePublica: string;
  readonly ativaDesde: string;
}

describe.skipIf(!INFRA_DISPONIVEL)('auditoria pública (Postgres e Redis reais)', () => {
  let ctx: AppDeIdentidade;
  let pool: pg.Pool;
  let banco: Banco;
  let cadeia: CadeiaDeLances;
  let leiloeiro: Conta;
  /** Relógio dos lances semeados: cresce 1 s por lance. */
  let relogio = Date.now() - 3 * HORA;

  beforeAll(async () => {
    ctx = await criarAppDeIdentidade();
    await registrarChaveDeAssinatura(ctx.app);
    pool = new pg.Pool(BANCO.conexao());
    banco = ctx.app.get<Banco>(TOKEN_DO_BANCO);
    cadeia = ctx.app.get(CadeiaDeLances);
    leiloeiro = await inserirUsuario(pool, 'leiloeiro');
  });

  afterAll(async () => {
    await pool.end();
    await ctx.fechar();
  });

  const licitante = (): Promise<Conta> => inserirUsuario(pool, 'licitante');

  /** Lote ao vivo, lance inicial R$ 10,00. */
  async function lote(): Promise<string> {
    const criado = await inserirLote(pool, leiloeiro.id, {
      lance_inicial_centavos: 1000,
      incremento_minimo_centavos: 100,
    });
    return criado.id;
  }

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

  /** Encerra ou cancela o lote em `lots` e grava o selo assinado. */
  async function selar(
    loteId: string,
    status: 'encerrado' | 'cancelado',
    vencedorId?: string,
  ): Promise<void> {
    // Ordem do encerramento (D7): o selo confere o lote ainda aberto, depois o status muda.
    const estado = await estadoDoLote(pool, loteId);
    const lote = {
      id: loteId,
      status: 'ao_vivo' as const,
      totalLances: estado.total,
      lanceAtualCentavos: estado.lanceAtualCentavos,
      liderId: estado.liderId,
    };
    await banco.transaction((tx) =>
      cadeia.selar(tx, { loteId, status, seladoEm: new Date(), lote }),
    );
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
      [loteId, status, vencedorId ?? null],
    );
  }

  /** SQL direto com o trigger desligado só nesta transação; rollback em qualquer falha. */
  async function adulterar(sql: string, parametros: readonly unknown[]): Promise<void> {
    const cliente = await pool.connect();
    try {
      await cliente.query('begin');
      await cliente.query('alter table bids disable trigger user');
      await cliente.query(sql, [...parametros]);
      await cliente.query('alter table bids enable trigger user');
      await cliente.query('commit');
    } catch (erro) {
      await cliente.query('rollback');
      throw erro;
    } finally {
      cliente.release();
    }
  }

  const obter = (url: string): Promise<LightMyRequestResponse> =>
    ctx.app.inject({ method: 'GET', url });

  const auditoria = (loteId: string): Promise<LightMyRequestResponse> =>
    obter(`/api/auditoria/lotes/${loteId}`);

  const dados = <T>(resposta: LightMyRequestResponse): T => resposta.json<{ dados: T }>().dados;

  function semDadosDeUsuario(corpo: string, ...contas: readonly Conta[]): void {
    for (const c of contas) {
      expect(corpo).not.toContain(c.id);
      expect(corpo).not.toContain(c.nome);
      expect(corpo).not.toContain(c.email);
    }
    expect(corpo).not.toMatch(/licitante_?id|liderId|vencedorId|"email"|"nome"/i);
  }

  describe('GET /api/auditoria/lotes/{id}', () => {
    it('lote ao vivo íntegro: cadeia inteira por seq crescente, sem selo e sem cache', async () => {
      const a = await licitante();
      const b = await licitante();
      const loteId = await lote();
      await semear(loteId, a, 1000);
      await semear(loteId, b, 1100);
      await semear(loteId, a, 1200);

      const resposta = await auditoria(loteId);

      expect(resposta.statusCode).toBe(200);
      expect(resposta.headers['cache-control']).toBe('no-store');
      const corpo = dados<AuditoriaJson>(resposta);
      expect(corpo.veredito).toBe('integro');
      expect(corpo.problemas).toEqual([]);
      expect(corpo.selo).toBeNull();
      expect(corpo.lote).toMatchObject({ id: loteId, status: 'ao_vivo', totalLances: 3 });
      expect(corpo.lances.map((l) => [l.seq, l.valorCentavos])).toEqual([
        [1, 1000],
        [2, 1100],
        [3, 1200],
      ]);
      expect(corpo.lances[0]?.hashAnterior).toBe(hashGenese(loteId));
      expect(corpo.lances[1]?.hashAnterior).toBe(corpo.lances[0]?.hash);
      semDadosDeUsuario(resposta.body, a, b, leiloeiro);
    });

    it('devolve a cadeia sem paginação (mais de 50 lances)', async () => {
      const a = await licitante();
      const loteId = await lote();
      for (let i = 0; i < 55; i += 1) await semear(loteId, a, 1000 + i * 100);

      const corpo = dados<AuditoriaJson>(await auditoria(loteId));

      expect(corpo.lances).toHaveLength(55);
      expect(corpo.lances.at(-1)?.seq).toBe(55);
      expect(corpo.veredito).toBe('integro');
    });

    it('lote encerrado e selado: selo com o hash final e veredito íntegro, sem cache', async () => {
      const a = await licitante();
      const b = await licitante();
      const loteId = await lote();
      await semear(loteId, a, 1000);
      await semear(loteId, b, 1500);
      await selar(loteId, 'encerrado', b.id);

      const resposta = await auditoria(loteId);

      expect(resposta.statusCode).toBe(200);
      expect(resposta.headers['cache-control']).toBe('no-store');
      const corpo = dados<AuditoriaJson>(resposta);
      expect(corpo.veredito).toBe('integro');
      expect(corpo.lote.status).toBe('encerrado');
      expect(corpo.selo).toMatchObject({
        status: 'encerrado',
        totalLances: 2,
        hashFinal: corpo.lances[1]?.hash,
        vencedorPseudonimo: corpo.lances[1]?.pseudonimo,
        valorArremateCentavos: 1500,
      });
      semDadosDeUsuario(resposta.body, a, b, leiloeiro);
    });

    it('lote cancelado sem lances: cadeia vazia, selo da gênese e íntegro', async () => {
      const loteId = await lote();
      await selar(loteId, 'cancelado');

      const corpo = dados<AuditoriaJson>(await auditoria(loteId));

      expect(corpo.lances).toEqual([]);
      expect(corpo.selo).toMatchObject({ status: 'cancelado', totalLances: 0 });
      expect(corpo.selo?.hashFinal).toBe(hashGenese(loteId));
      expect(corpo.veredito).toBe('integro');
    });

    it('valor alterado por SQL com o trigger desligado → adulterado com o seq', async () => {
      const loteId = await lote();
      await semear(loteId, await licitante(), 15_000);
      await semear(loteId, await licitante(), 16_500);
      await adulterar('update bids set valor_centavos = 99999 where lote_id = $1 and seq = 2', [
        loteId,
      ]);

      const resposta = await auditoria(loteId);

      expect(resposta.statusCode).toBe(200);
      const corpo = dados<AuditoriaJson>(resposta);
      expect(corpo.veredito).toBe('adulterado');
      expect(corpo.problemas).toContainEqual(
        expect.objectContaining({ codigo: 'HASH_DIVERGENTE', seq: 2 }),
      );
      expect(corpo.problemas.every((p) => p.seq === 2)).toBe(true);
      // A resposta mostra o valor adulterado: é o que o navegador recalcula.
      expect(corpo.lances[1]?.valorCentavos).toBe(99_999);
    });

    it('lance removido de lote selado → adulterado na sequência e no selo', async () => {
      const a = await licitante();
      const loteId = await lote();
      await semear(loteId, a, 1000);
      await semear(loteId, a, 1100);
      await semear(loteId, a, 1200);
      await selar(loteId, 'encerrado', a.id);
      await adulterar('delete from bids where lote_id = $1 and seq = 2', [loteId]);

      const corpo = dados<AuditoriaJson>(await auditoria(loteId));

      expect(corpo.veredito).toBe('adulterado');
      expect(corpo.problemas).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ codigo: 'SEQ_FORA_DE_ORDEM', seq: 3 }),
          expect.objectContaining({ codigo: 'HASH_ANTERIOR_DIVERGENTE', seq: 3 }),
          expect.objectContaining({ codigo: 'SELO_TOTAL_DIVERGENTE', seq: null }),
        ]),
      );
    });

    it.each([UUID_INEXISTENTE, 'nao-e-uuid'])('%s → 404 NAO_ENCONTRADO sem cache', async (id) => {
      const resposta = await auditoria(id);

      expect(resposta.statusCode).toBe(404);
      expect(resposta.headers['cache-control']).toBe('no-store');
      expect(resposta.json()).toMatchObject({ sucesso: false, erro: { codigo: 'NAO_ENCONTRADO' } });
    });

    it('aceita o id em maiúsculas e devolve o id do banco', async () => {
      const loteId = await lote();

      const resposta = await auditoria(loteId.toUpperCase());

      expect(resposta.statusCode).toBe(200);
      expect(dados<AuditoriaJson>(resposta).lote.id).toBe(loteId);
    });
  });

  describe('GET /api/auditoria/chaves', () => {
    it('após a rotação lista a chave antiga e a nova, e o lote antigo continua íntegro', async () => {
      const loteId = await lote();
      await semear(loteId, await licitante(), 1000);
      // A chave antiga é a que assinou o lance (a do app de teste).
      const antiga = dados<AuditoriaJson>(await auditoria(loteId)).lances[0]?.keyId ?? '';
      // Rotação simulada: uma chave nova entra em signing_keys como o boot a registraria.
      const nova = derivarChaves(new Uint8Array(randomBytes(32)));
      await pool.query('insert into signing_keys (key_id, chave_publica) values ($1, $2)', [
        nova.keyId,
        Buffer.from(nova.chavePublica),
      ]);

      const resposta = await obter('/api/auditoria/chaves');

      expect(resposta.statusCode).toBe(200);
      expect(resposta.headers['cache-control']).toBe('public, max-age=60');
      const chaves = dados<ChaveJson[]>(resposta);
      const ids = chaves.map((c) => c.keyId);
      // Outros arquivos registram chaves em paralelo: confere a ordem relativa, não a posição.
      expect(ids.indexOf(antiga)).toBeGreaterThanOrEqual(0);
      expect(ids.indexOf(antiga)).toBeLessThan(ids.indexOf(nova.keyId));
      const ordenadas = [...chaves].sort(
        (x, y) => x.ativaDesde.localeCompare(y.ativaDesde) || x.keyId.localeCompare(y.keyId),
      );
      expect(chaves).toEqual(ordenadas);
      expect(chaves.find((c) => c.keyId === nova.keyId)).toEqual({
        keyId: nova.keyId,
        algoritmo: 'Ed25519',
        chavePublica: Buffer.from(nova.chavePublica).toString('base64url'),
        ativaDesde: expect.any(String) as unknown,
      });
      for (const chave of chaves) {
        expect(Object.keys(chave).sort()).toEqual([
          'algoritmo',
          'ativaDesde',
          'chavePublica',
          'keyId',
        ]);
      }
      expect(dados<AuditoriaJson>(await auditoria(loteId)).veredito).toBe('integro');
    });
  });
});
