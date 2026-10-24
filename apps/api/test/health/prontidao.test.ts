import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ServicoDeProntidao,
  TEMPO_LIMITE_DA_VERIFICACAO_MS,
  type VerificacaoDeProntidao,
} from '../../src/health/prontidao.js';

const ok = (nome: string): VerificacaoDeProntidao => ({ nome, verificar: async () => {} });

const falha = (nome: string): VerificacaoDeProntidao => ({
  nome,
  verificar: async () => {
    throw new Error(`${nome} fora`);
  },
});

const travada = (nome: string): VerificacaoDeProntidao => ({
  nome,
  verificar: () => new Promise<void>(() => {}),
});

describe('ServicoDeProntidao', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fica pronto quando todas as verificações passam', async () => {
    const servico = new ServicoDeProntidao([ok('postgres'), ok('redis')]);

    await expect(servico.verificar()).resolves.toEqual({ pronto: true, falhas: [] });
  });

  it('não fica pronto quando uma verificação falha e informa qual', async () => {
    const servico = new ServicoDeProntidao([ok('postgres'), falha('redis')]);

    await expect(servico.verificar()).resolves.toEqual({ pronto: false, falhas: ['redis'] });
  });

  it('lista todas as verificações que falharam', async () => {
    const servico = new ServicoDeProntidao([falha('postgres'), falha('redis')]);

    await expect(servico.verificar()).resolves.toEqual({
      pronto: false,
      falhas: ['postgres', 'redis'],
    });
  });

  it('nunca se declara pronto sem nenhuma verificação registrada (falha fechada)', async () => {
    const servico = new ServicoDeProntidao([]);

    const resultado = await servico.verificar();

    expect(resultado.pronto).toBe(false);
  });

  it('trata como falha a verificação que excede o tempo limite', async () => {
    vi.useFakeTimers();
    const servico = new ServicoDeProntidao([ok('postgres'), travada('redis')]);

    const promessa = servico.verificar();
    await vi.advanceTimersByTimeAsync(TEMPO_LIMITE_DA_VERIFICACAO_MS);

    await expect(promessa).resolves.toEqual({ pronto: false, falhas: ['redis'] });
  });
});
