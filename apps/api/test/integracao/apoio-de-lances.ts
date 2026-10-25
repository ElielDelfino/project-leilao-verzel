// Apoio dos testes de concorrência de lances (tarefa 088): contas com saldo, lotes, POST de lance e
// as conferências de invariantes depois de uma disputa (cadeia pela verificação pura, ledger e
// carteiras). Tudo pelo caminho real: API de teste com Postgres e Redis, fixtures por SQL.
import { randomUUID } from 'node:crypto';

import type { LightMyRequestResponse } from 'fastify';
import type pg from 'pg';
import { expect } from 'vitest';

import { emitirAccessToken } from '../../src/modules/identidade/tokens.js';
import { verificarCadeia } from '../../src/modules/lances/integridade/verificacao.js';
import { inserirLote, inserirUsuario } from '../helpers/lotes-por-sql.js';
import { type AppDeIdentidade, CHAVE_JWT } from '../modules/identidade/ambiente.js';
import { divergenciasDaCarteira } from './reconciliacao.js';

export const CSRF = 'csrf-de-teste-de-concorrencia';
export const LANCE_INICIAL_CENTAVOS = 1000;
export const INCREMENTO_CENTAVOS = 100;
const SALDO_PADRAO_CENTAVOS = 1_000_000;
const DEPOSITOS_POR_VEZ = 10;

export interface Conta {
  readonly id: string;
  readonly cabecalhos: Readonly<Record<string, string>>;
}

export interface LanceGravado {
  readonly seq: number;
  readonly licitanteId: string;
  readonly valorCentavos: number;
}

export interface RespostaDeErro {
  readonly codigo?: string;
  readonly detalhes?: unknown;
}

export function erro(resposta: LightMyRequestResponse): RespostaDeErro {
  return (resposta.json() as { erro?: RespostaDeErro }).erro ?? {};
}

export interface ApoioDeLances {
  conta(): Promise<Conta>;
  /** `quantidade` licitantes com saldo, depositando em grupos (o depósito tem limite de taxa). */
  licitantesComSaldo(quantidade: number, centavos?: number): Promise<Conta[]>;
  lote(extra?: Record<string, string | number>): Promise<string>;
  lancar(
    quem: Conta,
    loteId: string,
    valorCentavos: number,
    chave?: string,
  ): Promise<LightMyRequestResponse>;
  /** Lances do lote por `seq`, lidos direto do banco. */
  lancesDoLote(loteId: string): Promise<LanceGravado[]>;
  /** Invariantes de um lote depois da disputa; devolve os lances gravados. */
  conferirLote(loteId: string): Promise<LanceGravado[]>;
  /** Carteiras: comprometido esperado por conta, `comprometido ≤ total` e ledger reconciliado. */
  conferirCarteiras(
    contas: readonly Conta[],
    comprometidoEsperado: ReadonlyMap<string, number>,
  ): Promise<void>;
}

interface LinhaDoLance {
  seq: number;
  licitante_id: string;
  pseudonimo: string;
  valor_centavos: string;
  criado_em: Date;
  hash_anterior: Buffer;
  hash: Buffer;
  assinatura: Buffer;
  key_id: string;
}

export function criarApoioDeLances(
  ctx: AppDeIdentidade,
  pool: pg.Pool,
  leiloeiroId: string,
): ApoioDeLances {
  async function conta(): Promise<Conta> {
    const { id } = await inserirUsuario(pool, 'licitante');
    const token = await emitirAccessToken(CHAVE_JWT, { id, papel: 'licitante' });
    return {
      id,
      cabecalhos: { cookie: `access_token=${token}; csrf_token=${CSRF}`, 'x-csrf-token': CSRF },
    };
  }

  async function licitanteComSaldo(centavos: number): Promise<Conta> {
    const nova = await conta();
    const resposta = await ctx.app.inject({
      method: 'POST',
      url: '/api/carteira/depositos',
      headers: { ...nova.cabecalhos, 'idempotency-key': randomUUID() },
      payload: { valorCentavos: centavos },
    });
    expect(resposta.statusCode).toBe(201);
    return nova;
  }

  async function licitantesComSaldo(
    quantidade: number,
    centavos = SALDO_PADRAO_CENTAVOS,
  ): Promise<Conta[]> {
    const contas: Conta[] = [];
    for (let i = 0; i < quantidade; i += DEPOSITOS_POR_VEZ) {
      const grupo = Math.min(DEPOSITOS_POR_VEZ, quantidade - i);
      contas.push(
        ...(await Promise.all(Array.from({ length: grupo }, () => licitanteComSaldo(centavos)))),
      );
    }
    return contas;
  }

  async function lote(extra: Record<string, string | number> = {}): Promise<string> {
    const criado = await inserirLote(pool, leiloeiroId, {
      lance_inicial_centavos: LANCE_INICIAL_CENTAVOS,
      incremento_minimo_centavos: INCREMENTO_CENTAVOS,
      ...extra,
    });
    return criado.id;
  }

  function lancar(
    quem: Conta,
    loteId: string,
    valorCentavos: number,
    chave: string = randomUUID(),
  ): Promise<LightMyRequestResponse> {
    return ctx.app.inject({
      method: 'POST',
      url: `/api/lotes/${loteId}/lances`,
      headers: { ...quem.cabecalhos, 'idempotency-key': chave },
      payload: { valorCentavos },
    });
  }

  async function linhasDoLote(loteId: string): Promise<LinhaDoLance[]> {
    const { rows } = await pool.query<LinhaDoLance>(
      `select seq, licitante_id, pseudonimo, valor_centavos::text as valor_centavos, criado_em,
              hash_anterior, hash, assinatura, key_id
         from bids where lote_id = $1 order by seq`,
      [loteId],
    );
    return rows;
  }

  async function lancesDoLote(loteId: string): Promise<LanceGravado[]> {
    return (await linhasDoLote(loteId)).map((l) => ({
      seq: l.seq,
      licitanteId: l.licitante_id,
      valorCentavos: Number(l.valor_centavos),
    }));
  }

  async function conferirCadeia(loteId: string, linhas: readonly LinhaDoLance[]): Promise<void> {
    const { rows: chaves } = await pool.query<{ key_id: string; chave_publica: Buffer }>(
      'select key_id, chave_publica from signing_keys',
    );
    const resultado = verificarCadeia({
      loteId,
      lances: linhas.map((l) => ({
        seq: l.seq,
        pseudonimo: l.pseudonimo,
        valorCentavos: Number(l.valor_centavos),
        criadoEm: l.criado_em.toISOString(),
        hashAnterior: l.hash_anterior.toString('hex'),
        hash: l.hash.toString('hex'),
        assinatura: l.assinatura.toString('base64url'),
        keyId: l.key_id,
      })),
      selo: null,
      chaves: chaves.map((c) => ({
        keyId: c.key_id,
        chavePublica: new Uint8Array(c.chave_publica),
      })),
    });
    expect(resultado).toEqual({ veredito: 'integro', problemas: [] });
  }

  /** Um `compromisso` por lance (mesmo valor e licitante) e uma `liberacao` por lance superado. */
  async function conferirLedgerDoLote(loteId: string, total: number): Promise<void> {
    const { rows } = await pool.query<{ tipo: string; n: string }>(
      `select tipo::text as tipo, count(*)::text as n from ledger_entries
        where lote_id = $1 and tipo in ('compromisso', 'liberacao') group by tipo`,
      [loteId],
    );
    const porTipo = new Map(rows.map((r) => [r.tipo, Number(r.n)]));
    expect(porTipo.get('compromisso') ?? 0).toBe(total);
    expect(porTipo.get('liberacao') ?? 0).toBe(Math.max(0, total - 1));
    const { rows: casados } = await pool.query<{ n: string }>(
      `select count(*)::text as n from ledger_entries l join bids b on b.id = l.lance_id
        where l.lote_id = $1 and l.tipo = 'compromisso'
          and l.valor_centavos = b.valor_centavos and l.user_id = b.licitante_id`,
      [loteId],
    );
    expect(Number(casados[0]?.n)).toBe(total);
  }

  async function conferirLote(loteId: string): Promise<LanceGravado[]> {
    const linhas = await linhasDoLote(loteId);
    const lances = linhas.map((l) => ({
      seq: l.seq,
      licitanteId: l.licitante_id,
      valorCentavos: Number(l.valor_centavos),
    }));
    // seq contígua de 1 a N; o valor sobe pelo menos o incremento a cada lance aceito.
    expect(lances.map((l) => l.seq)).toEqual(
      Array.from({ length: lances.length }, (_, i) => i + 1),
    );
    lances.forEach((l, i) => {
      const minimo =
        i === 0
          ? LANCE_INICIAL_CENTAVOS
          : (lances[i - 1]?.valorCentavos ?? 0) + INCREMENTO_CENTAVOS;
      expect(l.valorCentavos).toBeGreaterThanOrEqual(minimo);
    });
    // O estado do lote é o do último lance: o maior, do único líder.
    const { rows } = await pool.query<{
      total_lances: number;
      lider_id: string | null;
      lance_atual_centavos: string | null;
    }>('select total_lances, lider_id, lance_atual_centavos::text from lots where id = $1', [
      loteId,
    ]);
    const ultimo = lances.at(-1);
    expect(rows[0]?.total_lances).toBe(lances.length);
    expect(rows[0]?.lider_id ?? null).toBe(ultimo?.licitanteId ?? null);
    expect(rows[0]?.lance_atual_centavos ?? null).toBe(
      ultimo === undefined ? null : String(ultimo.valorCentavos),
    );
    expect(Math.max(0, ...lances.map((l) => l.valorCentavos))).toBe(ultimo?.valorCentavos ?? 0);
    await conferirCadeia(loteId, linhas);
    await conferirLedgerDoLote(loteId, lances.length);
    return lances;
  }

  async function conferirCarteiras(
    contas: readonly Conta[],
    comprometidoEsperado: ReadonlyMap<string, number>,
  ): Promise<void> {
    const ids = contas.map((c) => c.id);
    const { rows } = await pool.query<{ user_id: string; total: string; comprometido: string }>(
      `select user_id, total_centavos::text as total, comprometido_centavos::text as comprometido
         from wallet_balances where user_id = any($1::uuid[])`,
      [ids],
    );
    expect(rows).toHaveLength(ids.length);
    for (const linha of rows) {
      expect(Number(linha.comprometido)).toBe(comprometidoEsperado.get(linha.user_id) ?? 0);
      expect(Number(linha.comprometido)).toBeLessThanOrEqual(Number(linha.total));
    }
    const divergentes = (await divergenciasDaCarteira(pool)).filter((d) => ids.includes(d.userId));
    expect(divergentes).toEqual([]);
  }

  return {
    conta,
    licitantesComSaldo,
    lote,
    lancar,
    lancesDoLote,
    conferirLote,
    conferirCarteiras,
  };
}
