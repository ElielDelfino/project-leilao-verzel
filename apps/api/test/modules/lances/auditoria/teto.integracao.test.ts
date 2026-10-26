// Integração (Postgres e Redis reais): teto de lances da verificação no servidor (tarefa 111).
// Acima de TETO_DE_LANCES_DA_AUDITORIA o servidor responde 503 INDISPONIVEL e nunca devolve uma
// cadeia truncada (truncar mudaria o veredito). O teto é conferido duas vezes: pelo `total_lances`
// do resumo do lote (antes de ler a cadeia) e pelo número de linhas lidas de `bids`.
import { randomUUID } from 'node:crypto';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TETO_DE_LANCES_DA_AUDITORIA } from '../../../../src/modules/lances/auditoria.js';
import { registrarChaveDeAssinatura } from '../../../../src/modules/lances/index.js';
import { apagarChavesDoPrefixo, clienteDeTeste } from '../../../common/limite/redis-de-teste.js';
import { criarAppDeTeste } from '../../../helpers/app-de-teste.js';
import { type ContaPorSql, inserirLote, inserirUsuario } from '../../../helpers/lotes-por-sql.js';
import { BANCO, envReal, INFRA_DISPONIVEL, REDIS } from '../../identidade/ambiente.js';

describe.skipIf(!INFRA_DISPONIVEL)('teto de lances da auditoria (Postgres real)', () => {
  const prefixo = `ratelimit:teste-${randomUUID()}:`;
  let app: NestFastifyApplication;
  let pool: pg.Pool;
  let leiloeiro: ContaPorSql;
  let licitante: ContaPorSql;
  let keyId: string;

  beforeAll(async () => {
    app = await criarAppDeTeste({ env: envReal(), clientesReais: true, prefixoDoLimite: prefixo });
    await registrarChaveDeAssinatura(app);
    pool = new pg.Pool(BANCO.conexao());
    leiloeiro = await inserirUsuario(pool, 'leiloeiro');
    licitante = await inserirUsuario(pool, 'licitante');
    const { rows } = await pool.query<{ key_id: string }>(
      'select key_id from signing_keys order by ativa_desde limit 1',
    );
    const lida = rows[0]?.key_id;
    if (lida === undefined) throw new Error('nenhuma chave de assinatura registrada');
    keyId = lida;
  });

  afterAll(async () => {
    const redis = await clienteDeTeste(REDIS.conexao());
    await apagarChavesDoPrefixo(redis, prefixo);
    redis.destroy();
    await pool.end();
    await app.close();
  });

  /** Lote ao vivo sem nenhum lance em `bids`, com o contador do resumo em `totalLances`. */
  async function loteComContador(totalLances: number): Promise<string> {
    const { id } = await inserirLote(pool, leiloeiro.id, { lance_inicial_centavos: 1000 });
    await pool.query('update lots set total_lances = $2 where id = $1', [id, totalLances]);
    return id;
  }

  /** `quantos` linhas em `bids` (hashes e assinaturas zerados), sem mexer no contador do lote. */
  async function inserirLinhasNaCadeia(loteId: string, quantos: number): Promise<void> {
    await pool.query(
      `insert into bids (lote_id, seq, licitante_id, pseudonimo, valor_centavos, criado_em,
                         hash_anterior, hash, assinatura, key_id, idempotency_key)
       select $1, s, $2, 'Licitante #000000', 1000 + s, now(),
              decode(repeat('00', 32), 'hex'), decode(repeat('00', 32), 'hex'),
              decode(repeat('00', 64), 'hex'), $3, gen_random_uuid()
         from generate_series(1, $4::int) as s`,
      [loteId, licitante.id, keyId, quantos],
    );
  }

  const auditoria = (loteId: string) =>
    app.inject({ method: 'GET', url: `/api/auditoria/lotes/${loteId}` });

  function esperar503(resposta: Awaited<ReturnType<typeof auditoria>>): void {
    expect(resposta.statusCode).toBe(503);
    const corpo = resposta.json<Record<string, unknown>>();
    expect(corpo).toMatchObject({ sucesso: false, erro: { codigo: 'INDISPONIVEL' } });
    expect(corpo).not.toHaveProperty('dados');
    expect(resposta.headers['cache-control']).toBe('no-store');
  }

  it('o teto é 1000 lances', () => {
    expect(TETO_DE_LANCES_DA_AUDITORIA).toBe(1000);
  });

  it('total_lances acima do teto → 503 sem ler a cadeia (bids vazia daria 200)', async () => {
    const loteId = await loteComContador(TETO_DE_LANCES_DA_AUDITORIA + 1);

    esperar503(await auditoria(loteId));
  });

  it('total_lances igual ao teto → 200', async () => {
    const loteId = await loteComContador(TETO_DE_LANCES_DA_AUDITORIA);

    const resposta = await auditoria(loteId);

    expect(resposta.statusCode).toBe(200);
    expect(resposta.headers['cache-control']).toBe('no-store');
  });

  it('mais linhas em bids que o teto, com total_lances 0 → 503, nunca cadeia truncada', async () => {
    const loteId = await loteComContador(0);
    await inserirLinhasNaCadeia(loteId, TETO_DE_LANCES_DA_AUDITORIA + 1);

    esperar503(await auditoria(loteId));
  });
});
