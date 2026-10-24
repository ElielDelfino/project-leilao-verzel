import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

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
  let avisos: MockInstance<Logger['warn']>;

  beforeEach(() => {
    // Silencia e observa o logger do Nest (o serviço avisa cada falha).
    avisos = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('fica pronto quando todas as verificações passam', async () => {
    const servico = new ServicoDeProntidao([ok('postgres'), ok('redis')]);

    await expect(servico.verificar()).resolves.toEqual({ pronto: true, falhas: [] });
    expect(avisos).not.toHaveBeenCalled();
  });

  it('não fica pronto quando uma verificação falha e informa qual', async () => {
    const servico = new ServicoDeProntidao([ok('postgres'), falha('redis')]);

    await expect(servico.verificar()).resolves.toEqual({ pronto: false, falhas: ['redis'] });
    expect(avisos).toHaveBeenCalledWith(expect.stringContaining('redis'));
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

  it('trata como falha a verificação que lança de forma síncrona, sem derrubar as outras', async () => {
    const sincrona: VerificacaoDeProntidao = {
      nome: 'redis',
      verificar: () => {
        throw new Error('lançou antes de devolver a promessa');
      },
    };
    const servico = new ServicoDeProntidao([ok('postgres'), sincrona]);

    await expect(servico.verificar()).resolves.toEqual({ pronto: false, falhas: ['redis'] });
  });

  it('trata como falha a verificação que excede o tempo limite', async () => {
    vi.useFakeTimers();
    const servico = new ServicoDeProntidao([ok('postgres'), travada('redis')]);

    const promessa = servico.verificar();
    await vi.advanceTimersByTimeAsync(TEMPO_LIMITE_DA_VERIFICACAO_MS);

    await expect(promessa).resolves.toEqual({ pronto: false, falhas: ['redis'] });
  });

  it('entrega um AbortSignal que é abortado quando o tempo limite estoura', async () => {
    vi.useFakeTimers();
    const sinais: AbortSignal[] = [];
    const observada: VerificacaoDeProntidao = {
      nome: 'redis',
      verificar: (sinal) => {
        sinais.push(sinal);
        return new Promise<void>(() => {});
      },
    };
    const servico = new ServicoDeProntidao([observada]);

    const promessa = servico.verificar();
    expect(sinais).toHaveLength(1);
    expect(sinais[0]?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(TEMPO_LIMITE_DA_VERIFICACAO_MS);
    await promessa;

    expect(sinais[0]?.aborted).toBe(true);
  });

  it('não aborta o sinal da verificação que terminou a tempo', async () => {
    vi.useFakeTimers();
    const sinais: AbortSignal[] = [];
    const rapida: VerificacaoDeProntidao = {
      nome: 'postgres',
      verificar: async (sinal) => {
        sinais.push(sinal);
      },
    };
    const servico = new ServicoDeProntidao([rapida]);

    await servico.verificar();
    await vi.advanceTimersByTimeAsync(TEMPO_LIMITE_DA_VERIFICACAO_MS * 2);

    expect(sinais[0]?.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
