// Unidade: barramento de eventos de domínio (tarefa 077, specs/009).
import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';

import { aposCommit } from '../../../src/common/eventos/apos-commit.js';
import { EventosModule } from '../../../src/common/eventos/eventos.module.js';
import {
  type EventoDeDominio,
  PublicadorDeEventos,
} from '../../../src/common/eventos/publicador-de-eventos.js';

const LOTE_ID = '3f0c1d52-8a4e-4f57-9a55-6d3a1f0b7c11';
const lanceUm: EventoDeDominio = { tipo: 'lote_iniciado', payload: { loteId: LOTE_ID } };
const lanceDois: EventoDeDominio = { tipo: 'lote_cancelado', payload: { loteId: LOTE_ID } };

function criar() {
  const falhas: { tipo: string; erro: unknown }[] = [];
  const publicador = new PublicadorDeEventos({
    falhaDeAssinante: (tipo, erro) => {
      falhas.push({ tipo, erro });
    },
  });
  return { publicador, falhas };
}

describe('PublicadorDeEventos', () => {
  it('entrega o payload só aos assinantes do tipo publicado', () => {
    const { publicador } = criar();
    const iniciado = vi.fn();
    const cancelado = vi.fn();
    publicador.aoOcorrer('lote_iniciado', iniciado);
    publicador.aoOcorrer('lote_cancelado', cancelado);

    publicador.publicar(lanceUm);

    expect(iniciado).toHaveBeenCalledExactlyOnceWith({ loteId: LOTE_ID });
    expect(cancelado).not.toHaveBeenCalled();
  });

  it('o assinante que lança não derruba os demais nem o publicador', () => {
    const { publicador, falhas } = criar();
    const depois = vi.fn();
    publicador.aoOcorrer('lote_iniciado', () => {
      throw new Error('segredo@exemplo.com');
    });
    publicador.aoOcorrer('lote_iniciado', depois);

    expect(() => {
      publicador.publicar(lanceUm);
    }).not.toThrow();

    expect(depois).toHaveBeenCalledOnce();
    expect(falhas).toHaveLength(1);
    expect(falhas[0]?.tipo).toBe('lote_iniciado');
  });

  it('o assinante assíncrono que rejeita é capturado e registrado', async () => {
    const { publicador, falhas } = criar();
    const depois = vi.fn();
    publicador.aoOcorrer('lote_iniciado', () => Promise.reject(new Error('falha')));
    publicador.aoOcorrer('lote_iniciado', depois);

    publicador.publicar(lanceUm);
    await new Promise((resolver) => setImmediate(resolver));

    expect(depois).toHaveBeenCalledOnce();
    expect(falhas).toHaveLength(1);
  });

  it('o registro que falha também não afeta o publicador', () => {
    const publicador = new PublicadorDeEventos({
      falhaDeAssinante: () => {
        throw new Error('registro quebrado');
      },
    });
    publicador.aoOcorrer('lote_iniciado', () => {
      throw new Error('x');
    });

    expect(() => {
      publicador.publicar(lanceUm);
    }).not.toThrow();
  });

  it('a função devolvida por aoOcorrer remove o assinante', () => {
    const { publicador } = criar();
    const assinante = vi.fn();
    const remover = publicador.aoOcorrer('lote_iniciado', assinante);
    remover();

    publicador.publicar(lanceUm);

    expect(assinante).not.toHaveBeenCalled();
  });
});

describe('aposCommit', () => {
  it('publica os eventos agendados, em ordem, só depois que a transação confirma', async () => {
    const { publicador } = criar();
    const recebidos: string[] = [];
    publicador.aoOcorrer('lote_iniciado', () => {
      recebidos.push('iniciado');
    });
    publicador.aoOcorrer('lote_cancelado', () => {
      recebidos.push('cancelado');
    });

    const resultado = await aposCommit(publicador, async (coletor) => {
      coletor.agendar(lanceUm);
      coletor.agendar(lanceDois);
      await Promise.resolve();
      expect(recebidos).toEqual([]);
      return 42;
    });

    expect(resultado).toBe(42);
    expect(recebidos).toEqual(['iniciado', 'cancelado']);
  });

  it('no rollback não publica nada e repassa o erro', async () => {
    const { publicador } = criar();
    const assinante = vi.fn();
    publicador.aoOcorrer('lote_iniciado', assinante);

    await expect(
      aposCommit(publicador, (coletor) => {
        coletor.agendar(lanceUm);
        return Promise.reject(new Error('rollback'));
      }),
    ).rejects.toThrow('rollback');

    expect(assinante).not.toHaveBeenCalled();
  });

  it('assinante que lança depois do commit não altera o resultado da transação', async () => {
    const { publicador } = criar();
    publicador.aoOcorrer('lote_iniciado', () => {
      throw new Error('falha');
    });

    const resultado = await aposCommit(publicador, (coletor) => {
      coletor.agendar(lanceUm);
      return Promise.resolve('ok');
    });

    expect(resultado).toBe('ok');
  });
});

describe('EventosModule', () => {
  it('fornece um PublicadorDeEventos único e global', async () => {
    const modulo = await Test.createTestingModule({ imports: [EventosModule] }).compile();

    const publicador = modulo.get(PublicadorDeEventos);

    expect(publicador).toBeInstanceOf(PublicadorDeEventos);
    expect(modulo.get(PublicadorDeEventos)).toBe(publicador);
  });
});
