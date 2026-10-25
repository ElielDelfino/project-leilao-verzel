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

  // specs/014 §Observabilidade: o motivo vai ao log "sem host nem senha" (revisão da 018, MEDIUM).
  it('o aviso traz o nome da dependência e o código do erro, nunca a mensagem do driver', async () => {
    const recusada = Object.assign(new Error('connect ECONNREFUSED 10.1.2.3:5432 senha=abc'), {
      code: 'ECONNREFUSED',
    });
    const servico = new ServicoDeProntidao([
      { nome: 'postgres', verificar: () => Promise.reject(recusada) },
    ]);

    await servico.verificar();

    const aviso = String(avisos.mock.calls[0]?.[0]);
    expect(aviso).toContain('postgres');
    expect(aviso).toContain('ECONNREFUSED');
    expect(aviso).not.toContain('10.1.2.3');
    expect(aviso).not.toContain('5432');
    expect(aviso).not.toContain('senha');
  });

  it('o aviso usa o `codigo` dos erros convertidos (ErroDoBanco) e ignora códigos fora do formato', async () => {
    const convertido = Object.assign(new Error('Erro do banco de dados (código 28P01)'), {
      name: 'ErroDoBanco',
      codigo: '28P01',
    });
    const codigoEstranho = Object.assign(new Error('x'), { code: 'host 10.1.2.3' });
    const servico = new ServicoDeProntidao([
      { nome: 'postgres', verificar: () => Promise.reject(convertido) },
      { nome: 'redis', verificar: () => Promise.reject(codigoEstranho) },
      { nome: 'outra', verificar: () => Promise.reject('texto com senha') },
    ]);

    await servico.verificar();

    const avisosEmTexto = avisos.mock.calls.map((chamada) => String(chamada[0]));
    expect(avisosEmTexto[0]).toContain('ErroDoBanco');
    expect(avisosEmTexto[0]).toContain('28P01');
    expect(avisosEmTexto[1]).toContain('redis');
    expect(avisosEmTexto[1]).not.toContain('10.1.2.3');
    expect(avisosEmTexto[2]).not.toContain('senha');
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
