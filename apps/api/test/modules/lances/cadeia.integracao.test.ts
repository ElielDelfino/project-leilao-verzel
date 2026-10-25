// Integração (Postgres real): cadeia persistida do lote (tarefa 078; specs/008, specs/007 passo 5).
// anexar e selar gravam o que verificarCadeia (tarefa 076) aceita, e uma adulteração por SQL direto
// (trigger desligado) é detectada. A seed é gerada na hora e só vale neste arquivo.
import { randomBytes, randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { criarSegredosDaApi, type Env } from '../../../src/config/env.js';
import { type BancoVerificavel, criarBanco } from '../../../src/db/banco.js';
import { CadeiaDeLances, type LanceAnexado } from '../../../src/modules/lances/cadeia.js';
import { ServicoDeChaves } from '../../../src/modules/lances/chaves.js';
import { hashGenese } from '../../../src/modules/lances/integridade/hash.js';
import {
  type ChavePublicada,
  type LanceRegistrado,
  type SeloRegistrado,
  verificarCadeia,
} from '../../../src/modules/lances/integridade/verificacao.js';
import { agora } from '../../../src/modules/lotes/index.js';
import { ambienteDeTeste } from '../../db/ambiente-de-teste.js';
import { ENV_DE_TESTE } from '../../helpers/app-de-teste.js';
import { inserirLote, inserirUsuario } from '../../helpers/lotes-por-sql.js';

const BANCO = ambienteDeTeste(process.env);

interface LinhaDeBid {
  seq: number;
  pseudonimo: string;
  valor_centavos: string;
  criado_em: Date;
  hash_anterior: Buffer;
  hash: Buffer;
  assinatura: Buffer;
  key_id: string;
}

interface LinhaDeSelo {
  status: 'encerrado' | 'cancelado';
  total_lances: number;
  hash_final: Buffer;
  vencedor_pseudonimo: string | null;
  valor_arremate_centavos: string | null;
  selado_em: Date;
  assinatura: Buffer;
  key_id: string;
}

function envComSeed(seed: Uint8Array): Env {
  return {
    ...ENV_DE_TESTE,
    segredos: criarSegredosDaApi({
      chaveJwt: new Uint8Array(randomBytes(32)),
      chavePseudonimo: new Uint8Array(randomBytes(32)),
      sementeEd25519: seed,
    }),
  };
}

describe.skipIf(!BANCO.disponivel)('cadeia persistida do lote (Postgres real)', () => {
  let banco: BancoVerificavel;
  let pool: pg.Pool;
  let chaves: ServicoDeChaves;
  let cadeia: CadeiaDeLances;

  beforeAll(async () => {
    banco = criarBanco({ conexao: BANCO.conexao(), aoErroOcioso: () => undefined });
    pool = new pg.Pool(BANCO.conexao());
    chaves = new ServicoDeChaves(envComSeed(new Uint8Array(randomBytes(32))), banco);
    await chaves.registrar();
    cadeia = new CadeiaDeLances(chaves);
  });

  afterAll(async () => {
    await pool.end();
    await banco.encerrar();
  });

  async function novoLote(): Promise<string> {
    const leiloeiro = await inserirUsuario(pool, 'leiloeiro');
    return (await inserirLote(pool, leiloeiro.id)).id;
  }

  async function licitante(): Promise<string> {
    return (await inserirUsuario(pool, 'licitante')).id;
  }

  /** Um lance numa transação própria, com o `agora(tx)` lido depois de travar o lote. */
  function anexar(loteId: string, licitanteId: string, valor: number): Promise<LanceAnexado> {
    return banco.transaction(async (tx) => {
      await tx.execute(sql`select id from lots where id = ${loteId} for update`);
      return cadeia.anexar(tx, {
        loteId,
        licitanteId,
        valorCentavos: valor,
        criadoEm: await agora(tx),
        idempotencyKey: randomUUID(),
      });
    });
  }

  async function lancesGravados(loteId: string): Promise<LanceRegistrado[]> {
    const { rows } = await pool.query<LinhaDeBid>(
      `select seq, pseudonimo, valor_centavos, criado_em, hash_anterior, hash, assinatura, key_id
       from bids where lote_id = $1 order by seq`,
      [loteId],
    );
    return rows.map((r) => ({
      seq: r.seq,
      pseudonimo: r.pseudonimo,
      valorCentavos: Number(r.valor_centavos),
      criadoEm: r.criado_em.toISOString(),
      hashAnterior: r.hash_anterior.toString('hex'),
      hash: r.hash.toString('hex'),
      assinatura: r.assinatura.toString('base64url'),
      keyId: r.key_id,
    }));
  }

  async function seloGravado(loteId: string): Promise<SeloRegistrado | null> {
    const { rows } = await pool.query<LinhaDeSelo>(
      `select status, total_lances, hash_final, vencedor_pseudonimo, valor_arremate_centavos,
         selado_em, assinatura, key_id
       from lot_seals where lote_id = $1`,
      [loteId],
    );
    const r = rows[0];
    if (r === undefined) return null;
    return {
      status: r.status,
      totalLances: r.total_lances,
      hashFinal: r.hash_final.toString('hex'),
      vencedorPseudonimo: r.vencedor_pseudonimo,
      valorArremateCentavos:
        r.valor_arremate_centavos === null ? null : Number(r.valor_arremate_centavos),
      seladoEm: r.selado_em.toISOString(),
      assinatura: r.assinatura.toString('base64url'),
      keyId: r.key_id,
    };
  }

  async function chavesPublicadas(): Promise<ChavePublicada[]> {
    const { rows } = await pool.query<{ key_id: string; chave_publica: Buffer }>(
      'select key_id, chave_publica from signing_keys',
    );
    return rows.map((r) => ({ keyId: r.key_id, chavePublica: new Uint8Array(r.chave_publica) }));
  }

  async function verificarLote(loteId: string): Promise<ReturnType<typeof verificarCadeia>> {
    return verificarCadeia({
      loteId,
      lances: await lancesGravados(loteId),
      selo: await seloGravado(loteId),
      chaves: await chavesPublicadas(),
    });
  }

  it('encadeia 3 lances a partir da gênese, com seq contígua, e a verificação aceita', async () => {
    const loteId = await novoLote();
    const [a, b] = [await licitante(), await licitante()];

    const l1 = await anexar(loteId, a, 15_000);
    const l2 = await anexar(loteId, b, 16_500);
    const l3 = await anexar(loteId, a, 18_000);

    expect([l1.seq, l2.seq, l3.seq]).toEqual([1, 2, 3]);
    expect(l1.hashAnterior).toBe(hashGenese(loteId));
    expect(l2.hashAnterior).toBe(l1.hash);
    expect(l3.hashAnterior).toBe(l2.hash);
    expect([l1.lanceAnteriorId, l2.lanceAnteriorId, l3.lanceAnteriorId]).toEqual([
      null,
      l1.id,
      l2.id,
    ]);
    // Pseudônimo estável no lote; UUIDv7 no id (versão 7 no 13º hex).
    expect(l3.pseudonimo).toBe(l1.pseudonimo);
    expect(l2.pseudonimo).not.toBe(l1.pseudonimo);
    expect(l1.id[14]).toBe('7');
    expect(l1.keyId).toBe(chaves.keyId);

    const gravados = await lancesGravados(loteId);
    // O instante gravado é exatamente o assinado (timestamptz(3), truncado em ms).
    expect(gravados.map((l) => l.criadoEm)).toEqual([l1.criadoEm, l2.criadoEm, l3.criadoEm]);
    expect(gravados.map((l) => l.assinatura)).toEqual([
      l1.assinatura,
      l2.assinatura,
      l3.assinatura,
    ]);
    expect(await verificarLote(loteId)).toEqual({ veredito: 'integro', problemas: [] });
  });

  it('sela o lote encerrado com o último lance como vencedor, e a verificação aceita', async () => {
    const loteId = await novoLote();
    await anexar(loteId, await licitante(), 15_000);
    const liderId = await licitante();
    const ultimo = await anexar(loteId, liderId, 20_000);
    const lote = {
      id: loteId,
      status: 'ao_vivo' as const,
      totalLances: 2,
      lanceAtualCentavos: 20_000,
      liderId,
    };

    const selo = await banco.transaction(async (tx) =>
      cadeia.selar(tx, { loteId, status: 'encerrado', seladoEm: await agora(tx), lote }),
    );

    expect(selo).toMatchObject({
      ultimoLanceId: ultimo.id,
      totalLances: 2,
      hashFinal: ultimo.hash,
      vencedorPseudonimo: ultimo.pseudonimo,
      valorArremateCentavos: 20_000,
      keyId: chaves.keyId,
    });
    expect(await seloGravado(loteId)).toMatchObject({
      seladoEm: selo.seladoEm,
      assinatura: selo.assinatura,
    });
    expect(await verificarLote(loteId)).toEqual({ veredito: 'integro', problemas: [] });
  });

  it('sela lote cancelado sem lance com a gênese e sem vencedor', async () => {
    const loteId = await novoLote();

    const selo = await banco.transaction(async (tx) =>
      cadeia.selar(tx, {
        loteId,
        status: 'cancelado',
        seladoEm: await agora(tx),
        lote: {
          id: loteId,
          status: 'agendado',
          totalLances: 0,
          lanceAtualCentavos: null,
          liderId: null,
        },
      }),
    );

    expect(selo).toMatchObject({
      ultimoLanceId: null,
      totalLances: 0,
      hashFinal: hashGenese(loteId),
      vencedorPseudonimo: null,
      valorArremateCentavos: null,
    });
    expect(await verificarLote(loteId)).toEqual({ veredito: 'integro', problemas: [] });
  });

  it('detecta a alteração de valor feita por SQL com o trigger desligado', async () => {
    const loteId = await novoLote();
    await anexar(loteId, await licitante(), 15_000);
    await anexar(loteId, await licitante(), 16_500);
    const cliente = await pool.connect();
    try {
      // Tudo numa transação: as outras sessões nunca veem o trigger desligado.
      await cliente.query('begin');
      await cliente.query('alter table bids disable trigger user');
      await cliente.query(`update bids set valor_centavos = 99999 where lote_id = $1 and seq = 2`, [
        loteId,
      ]);
      await cliente.query('alter table bids enable trigger user');
      await cliente.query('commit');
    } catch (erro) {
      await cliente.query('rollback');
      throw erro;
    } finally {
      cliente.release();
    }

    const resultado = await verificarLote(loteId);

    expect(resultado.veredito).toBe('adulterado');
    expect(resultado.problemas).toContainEqual(
      expect.objectContaining({ codigo: 'HASH_DIVERGENTE', seq: 2 }),
    );
  });

  it('dois boots seguidos com a mesma chave deixam uma linha só em signing_keys', async () => {
    const seed = new Uint8Array(randomBytes(32));
    const primeiro = new ServicoDeChaves(envComSeed(seed), banco);
    await primeiro.registrar();
    const lerLinhas = (): Promise<pg.QueryResult<{ ativa_desde: Date }>> =>
      pool.query('select ativa_desde from signing_keys where key_id = $1', [primeiro.keyId]);
    const antes = await lerLinhas();

    const segundo = new ServicoDeChaves(envComSeed(seed), banco);
    await segundo.registrar();
    const depois = await lerLinhas();

    expect(segundo.keyId).toBe(primeiro.keyId);
    expect(depois.rowCount).toBe(1);
    expect(depois.rows[0]?.ativa_desde.getTime()).toBe(antes.rows[0]?.ativa_desde.getTime());
  });
});
