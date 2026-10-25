// Agendador de 1 s (tarefa 107; specs/010): unidade com relógio simulado. Sem banco: a interface
// de lotes é mockada e o serviço de encerramento é um duplo.
import { Logger } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EventoDeDominio } from '../../../../src/common/eventos/publicador-de-eventos.js';
import { PublicadorDeEventos } from '../../../../src/common/eventos/publicador-de-eventos.js';
import type { Banco } from '../../../../src/db/banco.js';
import {
  AgendadorDoEncerramento,
  descreverErro,
  INTERVALO_DO_AGENDADOR_MS,
} from '../../../../src/modules/liquidacao/agendador/agendador-do-encerramento.js';
import {
  BACKOFF_TETO_MS,
  BackoffDeLotes,
  LIMITE_DE_LOTES_EM_BACKOFF,
} from '../../../../src/modules/liquidacao/agendador/backoff-de-lotes.js';
import { ErroDeLiquidacao } from '../../../../src/modules/liquidacao/index.js';
import type { ServicoDeEncerramento } from '../../../../src/modules/liquidacao/index.js';

const lotes = vi.hoisted(() => ({
  iniciar: vi.fn<(tx: unknown) => Promise<string[]>>(),
  candidatos:
    vi.fn<(db: unknown, limite: number, excluir: readonly string[]) => Promise<string[]>>(),
}));
vi.mock('../../../../src/modules/lotes/index.js', () => ({
  iniciarLotesPendentes: lotes.iniciar,
  candidatosAoEncerramento: lotes.candidatos,
}));

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const C = '00000000-0000-4000-8000-00000000000c';

const bancoFalso = {
  consultar: (fn: (db: unknown) => Promise<unknown>) => fn({}),
  transaction: (fn: (tx: unknown) => Promise<unknown>) => fn({ execute: () => Promise.resolve() }),
} as unknown as Banco;

interface Cenario {
  agendador: AgendadorDoEncerramento;
  encerrar: ReturnType<typeof vi.fn<(id: string) => Promise<unknown>>>;
  eventos: EventoDeDominio[];
  registro: SchedulerRegistry;
  erros: string[];
}

function montar(): Cenario {
  const eventos: EventoDeDominio[] = [];
  const publicador = new PublicadorDeEventos({ falhaDeAssinante: vi.fn() });
  publicador.aoOcorrer('lote_iniciado', (payload) => {
    eventos.push({ tipo: 'lote_iniciado', payload });
  });
  const encerrar = vi.fn<(id: string) => Promise<unknown>>(() => Promise.resolve(null));
  const registro = new SchedulerRegistry();
  const erros: string[] = [];
  vi.spyOn(Logger.prototype, 'error').mockImplementation((m: unknown) => {
    erros.push(String(m));
  });
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  const agendador = new AgendadorDoEncerramento(
    bancoFalso,
    publicador,
    { encerrar } as unknown as ServicoDeEncerramento,
    registro,
  );
  return { agendador, encerrar, eventos, registro, erros };
}

/** Varredura fiel: devolve os ids dados, menos os que o agendador pede para excluir. */
function candidatosSempre(ids: readonly string[]): void {
  lotes.candidatos.mockImplementation((_db, _limite, excluir) =>
    Promise.resolve(ids.filter((id) => !excluir.includes(id))),
  );
}

const ligar = (a: AgendadorDoEncerramento): Promise<boolean> =>
  a.iniciar({ registrarChave: () => Promise.resolve() });

describe('AgendadorDoEncerramento (unidade, relógio simulado)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    lotes.iniciar.mockReset().mockResolvedValue([]);
    lotes.candidatos.mockReset().mockResolvedValue([]);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('não liga sozinho: sem iniciar() nenhum tick roda', async () => {
    montar();
    await vi.advanceTimersByTimeAsync(5 * INTERVALO_DO_AGENDADOR_MS);
    expect(lotes.candidatos).not.toHaveBeenCalled();
  });

  it('faz um tick por segundo depois de iniciar() e para com parar()', async () => {
    const { agendador } = montar();
    expect(await ligar(agendador)).toBe(true);
    await vi.advanceTimersByTimeAsync(3 * INTERVALO_DO_AGENDADOR_MS);
    expect(lotes.candidatos).toHaveBeenCalledTimes(3);
    await agendador.parar();
    await vi.advanceTimersByTimeAsync(3 * INTERVALO_DO_AGENDADOR_MS);
    expect(lotes.candidatos).toHaveBeenCalledTimes(3);
  });

  it('sem chave registrada não inicia e registra só o motivo', async () => {
    const { agendador, erros } = montar();
    const ligou = await agendador.iniciar({
      registrarChave: () => Promise.reject(new Error('segredo-do-driver SELECT 1')),
    });
    expect(ligou).toBe(false);
    await vi.advanceTimersByTimeAsync(3 * INTERVALO_DO_AGENDADOR_MS);
    expect(lotes.candidatos).not.toHaveBeenCalled();
    expect(erros).toHaveLength(1);
    expect(erros[0]).toContain('chave de assinatura');
    expect(erros[0]).not.toContain('segredo-do-driver');
  });

  it('ticks não se sobrepõem e parar() espera o tick atual', async () => {
    const { agendador, encerrar } = montar();
    lotes.candidatos.mockResolvedValue([A]);
    let liberar: () => void = () => undefined;
    encerrar.mockImplementation(
      () =>
        new Promise((resolve) => {
          liberar = () => {
            resolve(null);
          };
        }),
    );
    await ligar(agendador);
    await vi.advanceTimersByTimeAsync(4 * INTERVALO_DO_AGENDADOR_MS);
    expect(lotes.candidatos).toHaveBeenCalledTimes(1);
    expect(encerrar).toHaveBeenCalledTimes(1);

    let parou = false;
    const parando = agendador.parar().then(() => {
      parou = true;
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(parou).toBe(false);
    liberar();
    await parando;
    expect(parou).toBe(true);
  });

  it('erro de um lote não impede os seguintes e o log leva só nome, código e loteId', async () => {
    const { agendador, encerrar, erros } = montar();
    lotes.candidatos.mockResolvedValue([A, B, C]);
    const cause = new Error('insert into receipts vencedor_id=SEGREDO valor=999');
    encerrar.mockImplementation((id) =>
      id === A
        ? Promise.reject(Object.assign(new ErroDeLiquidacao('SELO_INCOERENTE', A), { cause }))
        : Promise.resolve(null),
    );
    await agendador.executarTick();
    expect(encerrar.mock.calls.map(([id]) => id)).toEqual([A, B, C]);
    expect(erros).toHaveLength(1);
    expect(erros[0]).toContain('LOTE_COM_FALHA_DE_ENCERRAMENTO');
    expect(erros[0]).toContain('ErroDeLiquidacao');
    expect(erros[0]).toContain('SELO_INCOERENTE');
    expect(erros[0]).toContain(A);
    expect(erros[0]).not.toMatch(/SEGREDO|insert|valor=/);
  });

  it('erro de banco na varredura ou no início não derruba o tick nem o processo', async () => {
    const { agendador, encerrar } = montar();
    lotes.iniciar.mockRejectedValue(new Error('conexão perdida'));
    lotes.candidatos.mockRejectedValueOnce(new Error('conexão perdida'));
    await expect(agendador.executarTick()).resolves.toBeUndefined();
    expect(encerrar).not.toHaveBeenCalled();
    lotes.candidatos.mockResolvedValue([A]);
    await agendador.executarTick();
    expect(encerrar).toHaveBeenCalledWith(A);
  });

  it('publica lote_iniciado para cada lote aberto, depois do COMMIT', async () => {
    const { agendador, eventos } = montar();
    lotes.iniciar.mockResolvedValue([A, B]);
    await agendador.executarTick();
    expect(eventos.map((e) => e.payload)).toEqual([{ loteId: A }, { loteId: B }]);
  });

  it('não publica lote_iniciado se a transação do início falha', async () => {
    const { agendador, eventos } = montar();
    lotes.iniciar.mockImplementation(() => Promise.reject(new Error('falha')));
    await agendador.executarTick();
    expect(eventos).toEqual([]);
  });

  describe('backoff do lote veneno', () => {
    it('exclui o lote por 2 s, 4 s, 8 s... e ele volta à varredura quando o tempo expira', async () => {
      const { agendador, encerrar } = montar();
      candidatosSempre([A]);
      encerrar.mockRejectedValue(new ErroDeLiquidacao('SELO_INCOERENTE', A));
      await agendador.executarTick();
      expect(lotes.candidatos.mock.calls[0]?.[2]).toEqual([]);

      await vi.advanceTimersByTimeAsync(1_999);
      await agendador.executarTick();
      expect(lotes.candidatos.mock.calls[1]?.[2]).toEqual([A]);

      await vi.advanceTimersByTimeAsync(1);
      await agendador.executarTick(); // volta, falha de novo: 4 s
      expect(lotes.candidatos.mock.calls[2]?.[2]).toEqual([]);

      await vi.advanceTimersByTimeAsync(3_999);
      await agendador.executarTick();
      expect(lotes.candidatos.mock.calls[3]?.[2]).toEqual([A]);
      await vi.advanceTimersByTimeAsync(1);
      await agendador.executarTick(); // 8 s
      await vi.advanceTimersByTimeAsync(7_999);
      await agendador.executarTick();
      expect(lotes.candidatos.mock.calls[5]?.[2]).toEqual([A]);
    });

    it('alerta único por lote e erro comum nas falhas seguintes', async () => {
      const { agendador, encerrar, erros } = montar();
      candidatosSempre([A]);
      encerrar.mockRejectedValue(new ErroDeLiquidacao('SELO_INCOERENTE', A));
      for (let i = 0; i < 3; i++) {
        await agendador.executarTick();
        await vi.advanceTimersByTimeAsync(BACKOFF_TETO_MS);
      }
      expect(erros).toHaveLength(3);
      expect(erros.filter((e) => e.includes('LOTE_COM_FALHA_DE_ENCERRAMENTO'))).toHaveLength(1);
    });

    it('sucesso zera o contador: a próxima falha volta a alertar', async () => {
      const { agendador, encerrar, erros } = montar();
      candidatosSempre([A]);
      encerrar.mockRejectedValueOnce(new Error('x'));
      await agendador.executarTick();
      await vi.advanceTimersByTimeAsync(2_000);
      await agendador.executarTick(); // sucesso
      encerrar.mockRejectedValueOnce(new Error('x'));
      await agendador.executarTick();
      expect(erros.filter((e) => e.includes('LOTE_COM_FALHA_DE_ENCERRAMENTO'))).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1_999);
      await agendador.executarTick();
      expect(lotes.candidatos.mock.calls.at(-1)?.[2]).toEqual([A]); // de novo 2 s, não 4 s
    });

    it('lote que saiu da seleção (encerrado por outra instância) zera o contador', async () => {
      const { agendador, encerrar, erros } = montar();
      lotes.candidatos.mockResolvedValueOnce([A]);
      encerrar.mockRejectedValueOnce(new Error('x'));
      await agendador.executarTick();
      await vi.advanceTimersByTimeAsync(2_000);
      lotes.candidatos.mockResolvedValueOnce([]); // outra instância o encerrou
      await agendador.executarTick();
      lotes.candidatos.mockResolvedValue([A]);
      encerrar.mockRejectedValueOnce(new Error('x'));
      await agendador.executarTick();
      expect(erros.filter((e) => e.includes('LOTE_COM_FALHA_DE_ENCERRAMENTO'))).toHaveLength(2);
    });
  });
});

describe('BackoffDeLotes', () => {
  it('dobra até o teto de 60 s', () => {
    const backoff = new BackoffDeLotes();
    const esperas = Array.from({ length: 8 }, () => backoff.falhar(A, 0).esperaMs);
    expect(esperas).toEqual([2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000, 60_000]);
  });

  it('limita o tamanho do conjunto', () => {
    const backoff = new BackoffDeLotes();
    for (let i = 0; i < LIMITE_DE_LOTES_EM_BACKOFF + 50; i++)
      backoff.falhar(`lote-${String(i)}`, i);
    expect(backoff.tamanho).toBe(LIMITE_DE_LOTES_EM_BACKOFF);
  });
});

describe('descreverErro', () => {
  it('só nome e código em formato de identificador; nada de mensagem nem cause', () => {
    const erro = Object.assign(new Error('SELECT secreto'), {
      cause: 'x',
      codigo: 'COMPROMETIDO_INSUFICIENTE',
    });
    expect(descreverErro(erro)).toBe('erro=Error codigo=COMPROMETIDO_INSUFICIENTE');
    expect(descreverErro(Object.assign(new Error('m'), { codigo: 'com espaço; drop' }))).toBe(
      'erro=Error',
    );
    expect(descreverErro('texto solto')).toBe('erro=Error');
    expect(descreverErro(null)).toBe('erro=Error');
  });
});
