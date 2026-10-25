import { Logger } from '@nestjs/common';
import type { EventosDoServidor } from '@leilao/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  type EventoDeDominio,
  PublicadorDeEventos,
} from '../../../src/common/eventos/publicador-de-eventos.js';
import {
  CAMPOS_DOS_EVENTOS,
  DifusaoDeEventos,
  type EmissorDeSalas,
  EVENTOS_PRIVADOS,
  EVENTOS_PUBLICOS,
} from '../../../src/modules/tempo-real/difusao-de-eventos.js';
import { validarEvento } from './contrato-asyncapi.js';

// Ponte barramento → rooms (tarefa 083, specs/009 §Interfaces e contratos), com o publicador real
// e um emissor falso que registra cada emissão (rooms, evento e payload).

const LOTE = '0192f000-0000-7000-8000-0000000000a1';
const USUARIO = '0192f000-0000-7000-8000-0000000000b2';
const PSEUDONIMO = 'Licitante #a1b2c3';
const INSTANTE = '2026-10-25T12:00:00.000Z';

interface Emissao {
  readonly salas: readonly string[];
  readonly evento: string;
  readonly payload: unknown;
}

function emissorFalso(): EmissorDeSalas & { readonly emissoes: Emissao[] } {
  const emissoes: Emissao[] = [];
  return {
    emissoes,
    to: (salas) => ({
      emit: (evento, payload) => {
        emissoes.push({ salas: Array.isArray(salas) ? salas : [salas], evento, payload });
        return true;
      },
    }),
  };
}

function montar(): {
  publicador: PublicadorDeEventos;
  difusao: DifusaoDeEventos;
  emissor: ReturnType<typeof emissorFalso>;
  falhas: string[];
} {
  const falhas: string[] = [];
  const publicador = new PublicadorDeEventos({
    falhaDeAssinante: (tipo) => falhas.push(tipo),
  });
  const difusao = new DifusaoDeEventos(publicador);
  const emissor = emissorFalso();
  difusao.iniciar(emissor);
  return { publicador, difusao, emissor, falhas };
}

const PAYLOADS: { readonly [T in keyof EventosDoServidor]: EventosDoServidor[T] } = {
  lance_aceito: {
    loteId: LOTE,
    seq: 3,
    pseudonimo: PSEUDONIMO,
    valorCentavos: 1500,
    criadoEm: INSTANTE,
    fimEm: INSTANTE,
    totalLances: 3,
  },
  fim_estendido: { loteId: LOTE, fimEm: INSTANTE },
  lote_iniciado: { loteId: LOTE },
  lote_encerrado: { loteId: LOTE, vencedorPseudonimo: PSEUDONIMO, valorArremateCentavos: 1500 },
  lote_cancelado: { loteId: LOTE },
  voce_foi_superado: { loteId: LOTE, valorCentavos: 1600 },
  saldo_atualizado: { totalCentavos: 5000, comprometidoCentavos: 1500, disponivelCentavos: 3500 },
  lote_arrematado: { loteId: LOTE, codigoComprovante: 'Ab3Cd5Ef7Gh9Jk2M' },
};

function evento<T extends keyof EventosDoServidor>(tipo: T, usuarioId?: string): EventoDeDominio {
  return {
    tipo,
    payload: PAYLOADS[tipo],
    ...(usuarioId === undefined ? {} : { usuarioId }),
  } as EventoDeDominio;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('difusão dos eventos do barramento', () => {
  it('tipa os oito eventos do contrato: cinco públicos e três privados', () => {
    expect(Object.keys(CAMPOS_DOS_EVENTOS).sort()).toEqual(
      [...EVENTOS_PUBLICOS, ...EVENTOS_PRIVADOS].sort(),
    );
  });

  it.each(EVENTOS_PUBLICOS)(
    '%s vai para lote:{id} e vitrine numa emissão, no formato do asyncapi',
    (tipo) => {
      const { publicador, emissor } = montar();

      publicador.publicar(evento(tipo));

      expect(emissor.emissoes).toEqual([
        { salas: [`lote:${LOTE}`, 'vitrine'], evento: tipo, payload: PAYLOADS[tipo] },
      ]);
      validarEvento(tipo, emissor.emissoes[0]?.payload);
    },
  );

  it('evento público nunca vai para usuario:, mesmo com destinatário', () => {
    const { publicador, emissor } = montar();

    publicador.publicar(evento('lance_aceito', USUARIO));

    expect(emissor.emissoes.flatMap((e) => e.salas)).toEqual([`lote:${LOTE}`, 'vitrine']);
  });

  it('o room do lote usa o id em minúsculas', () => {
    const { publicador, emissor } = montar();

    publicador.publicar({
      tipo: 'fim_estendido',
      payload: { loteId: LOTE.toUpperCase(), fimEm: INSTANTE },
    });

    expect(emissor.emissoes[0]?.salas).toEqual([`lote:${LOTE}`, 'vitrine']);
  });

  it('o payload emitido só leva os campos do contrato (nada de id, nome ou e-mail)', () => {
    const { publicador, emissor } = montar();
    const comExtras = {
      ...PAYLOADS.lance_aceito,
      licitanteId: USUARIO,
      nome: 'Pessoa Secreta',
      email: 'secreta@exemplo.com',
    };

    publicador.publicar({ tipo: 'lance_aceito', payload: comExtras });

    expect(emissor.emissoes[0]?.payload).toEqual(PAYLOADS.lance_aceito);
    expect(JSON.stringify(emissor.emissoes)).not.toMatch(/Pessoa Secreta|secreta@|0000000000b2/);
  });

  it.each(EVENTOS_PRIVADOS)('%s vai só para usuario:{id} do destinatário', (tipo) => {
    const { publicador, emissor } = montar();

    publicador.publicar(evento(tipo, USUARIO));

    expect(emissor.emissoes).toEqual([
      { salas: [`usuario:${USUARIO}`], evento: tipo, payload: PAYLOADS[tipo] },
    ]);
    validarEvento(tipo, emissor.emissoes[0]?.payload);
  });

  it.each(EVENTOS_PRIVADOS)('%s sem destinatário é descartado e logado sem dados', (tipo) => {
    const aviso = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { publicador, emissor } = montar();

    publicador.publicar(evento(tipo));

    expect(emissor.emissoes).toEqual([]);
    expect(aviso).toHaveBeenCalledWith(`evento privado ${tipo} sem destinatário: descartado`);
    expect(JSON.stringify(aviso.mock.calls)).not.toContain(LOTE);
  });

  it('erro do emissor não sai do assinante nem impede os demais', () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { publicador, falhas } = montar();
    const quebrado = new DifusaoDeEventos(publicador);
    quebrado.iniciar({
      to: () => {
        throw new Error('adapter caiu');
      },
    });
    const outro = vi.fn();
    publicador.aoOcorrer('lance_aceito', outro);

    expect(() => {
      publicador.publicar(evento('lance_aceito'));
      publicador.publicar(evento('saldo_atualizado', USUARIO));
    }).not.toThrow();
    expect(outro).toHaveBeenCalledTimes(1);
    expect(falhas).toEqual([]);
    expect(Logger.prototype.error).toHaveBeenCalledWith('falha ao difundir lance_aceito (Error)');
  });

  it('ao destruir o módulo, deixa de difundir; iniciar de novo não duplica', () => {
    const { publicador, difusao, emissor } = montar();
    difusao.iniciar(emissor);
    publicador.publicar(evento('lote_cancelado'));
    expect(emissor.emissoes).toHaveLength(1);

    difusao.onModuleDestroy();
    publicador.publicar(evento('lote_cancelado'));

    expect(emissor.emissoes).toHaveLength(1);
  });
});
