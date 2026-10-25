import { describe, expect, it, vi } from 'vitest';

import type { BancoVerificavel } from '../../src/db/banco.js';
import { verificacaoDoPostgres, verificacaoDoRedis } from '../../src/health/verificacoes.js';
import type { ClienteRedis } from '../../src/redis/cliente.js';

function bancoFalso(verificar: BancoVerificavel['verificar']): BancoVerificavel {
  return {
    verificar,
    consultar: vi.fn(),
    transaction: vi.fn(),
    encerrar: vi.fn(async () => {}),
  };
}

describe('verificacaoDoPostgres (banco.verificar, specs/014 §Observabilidade)', () => {
  it('chama-se "postgres" e repassa o sinal a banco.verificar', async () => {
    const verificar = vi.fn(async () => {});
    const sinal = new AbortController().signal;
    const banco = bancoFalso(verificar);
    const verificacao = verificacaoDoPostgres(banco);

    await expect(verificacao.verificar(sinal)).resolves.toBeUndefined();

    expect(verificacao.nome).toBe('postgres');
    expect(verificar).toHaveBeenCalledWith(sinal);
    expect(banco.consultar).not.toHaveBeenCalled();
  });

  it('rejeita quando o banco rejeita', async () => {
    const falha = new Error('fora');
    const verificacao = verificacaoDoPostgres(bancoFalso(() => Promise.reject(falha)));

    await expect(verificacao.verificar(new AbortController().signal)).rejects.toBe(falha);
  });
});

describe('verificacaoDoRedis (PING, specs/014 §Observabilidade)', () => {
  it('chama-se "redis" e repassa o sinal ao PING', async () => {
    const ping = vi.fn(async () => {});
    const redis: ClienteRedis = { ping, encerrar: vi.fn(async () => {}) };
    const sinal = new AbortController().signal;
    const verificacao = verificacaoDoRedis(redis);

    await verificacao.verificar(sinal);

    expect(verificacao.nome).toBe('redis');
    expect(ping).toHaveBeenCalledWith(sinal);
  });
});
