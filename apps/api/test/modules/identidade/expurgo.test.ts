// Expurgo diário dos refresh tokens (specs/003 §Comportamento e §Dados).
import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ExpurgoDiario,
  expurgarRefreshTokens,
  INTERVALO_DO_EXPURGO_MS,
} from '../../../src/modules/identidade/expurgo.js';
import { bancoFalso } from '../../helpers/app-de-teste.js';
import { BANCO, cadastrar, criarAppDeIdentidade, INFRA_DISPONIVEL, Navegador } from './ambiente.js';
import pg from 'pg';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ExpurgoDiario (ciclo de vida)', () => {
  it('agenda a cada 24 h com unref e para no shutdown', async () => {
    vi.useFakeTimers();
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    const consultar = vi.fn(async () => 0);
    const expurgo = new ExpurgoDiario({ ...bancoFalso(), consultar } as never);

    expurgo.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(INTERVALO_DO_EXPURGO_MS);
    expect(consultar).toHaveBeenCalledTimes(1);

    expurgo.onApplicationShutdown();
    await vi.advanceTimersByTimeAsync(INTERVALO_DO_EXPURGO_MS * 2);
    expect(consultar).toHaveBeenCalledTimes(1);
    expect(INTERVALO_DO_EXPURGO_MS).toBe(86_400_000);
  });

  it('falha do banco vira aviso no log, sem lançar', async () => {
    const aviso = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    const expurgo = new ExpurgoDiario(bancoFalso());

    await expect(expurgo.executar(new Date())).resolves.toBeUndefined();
    expect(aviso).toHaveBeenCalledWith(expect.stringContaining('expurgo de refresh tokens falhou'));
  });
});

describe.skipIf(!INFRA_DISPONIVEL)('expurgarRefreshTokens com Postgres real', () => {
  it('apaga só os tokens expirados há mais de 1 dia em relação ao instante recebido', async () => {
    const ctx = await criarAppDeIdentidade();
    const cliente = new pg.Client(BANCO.conexao());
    await cliente.connect();
    try {
      const { resposta } = await cadastrar(new Navegador(ctx.app, '10.9.0.1'));
      const { id } = (resposta.json() as { dados: { usuario: { id: string } } }).dados.usuario;
      await cliente.query(
        `update refresh_tokens set expira_em = '2026-01-01T00:00:00Z' where user_id = $1`,
        [id],
      );
      const { criarBanco } = await import('../../../src/db/banco.js');
      const banco = criarBanco({ conexao: BANCO.conexao(), aoErroOcioso: () => undefined });
      try {
        // 12 h depois da expiração fica (folga de 1 dia); 36 h depois é apagado.
        expect(await expurgarRefreshTokens(banco, new Date('2026-01-01T12:00:00Z'))).toBe(0);
        expect(
          await expurgarRefreshTokens(banco, new Date('2026-01-02T12:00:00Z')),
        ).toBeGreaterThanOrEqual(1);
      } finally {
        await banco.encerrar();
      }
      const { rows } = await cliente.query('select 1 from refresh_tokens where user_id = $1', [id]);
      expect(rows).toHaveLength(0);
    } finally {
      await cliente.end();
      await ctx.fechar();
    }
  });
});
