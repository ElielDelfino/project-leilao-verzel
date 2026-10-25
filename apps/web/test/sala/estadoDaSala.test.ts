import { describe, expect, it } from 'vitest';

import {
  aplicarCancelado,
  aplicarEncerrado,
  aplicarFimEstendido,
  aplicarIniciado,
  aplicarLance,
  aplicarSuperado,
  criarEstadoDaSala,
  type EstadoDaSala,
} from '../../src/sala/estadoDaSala';
import { criarEstado, lanceAceito, FIM, ID } from '../apoio/salaApoio';

const FIM_MAIOR = '2026-10-25T14:07:03Z';
const FIM_MENOR = '2026-10-25T13:30:00Z';

function sala(
  lote: Parameters<typeof criarEstado>[0] = {},
  resto: Parameters<typeof criarEstado>[1] = {},
): EstadoDaSala {
  return criarEstadoDaSala(criarEstado(lote, resto), Date.parse('2026-10-25T12:00:00Z'));
}

function encerrada(): EstadoDaSala {
  const base = sala({}, { seuPseudonimo: 'Gato-1', suaPosicao: 'ganhando' });
  return aplicarEncerrado(base, {
    loteId: ID,
    vencedorPseudonimo: 'Gato-1',
    valorArremateCentavos: 123_456,
  });
}

describe('estadoDaSala: estado terminal não é revertido por evento atrasado', () => {
  it('lote_iniciado e lote_cancelado atrasados não alteram um lote encerrado', () => {
    const final = encerrada();

    expect(aplicarIniciado(final)).toBe(final);
    expect(aplicarCancelado(final)).toBe(final);
    expect(final.lote.status).toBe('encerrado');
  });

  it('lote_iniciado atrasado não altera um lote cancelado', () => {
    const cancelado = aplicarCancelado(sala());

    expect(cancelado.lote.status).toBe('cancelado');
    expect(aplicarIniciado(cancelado)).toBe(cancelado);
  });

  it('lance_aceito e voce_foi_superado depois do fim não sobrescrevem venceu/perdeu', () => {
    const final = encerrada();
    expect(final.suaPosicao).toBe('venceu');

    expect(aplicarLance(final, lanceAceito({ seq: 4, totalLances: 4 }))).toBe(final);
    expect(aplicarSuperado(final, { loteId: ID, valorCentavos: 130_000 })).toBe(final);
  });

  it('lance_aceito e voce_foi_superado depois do cancelamento são ignorados', () => {
    const cancelado = aplicarCancelado(sala({}, { suaPosicao: 'ganhando' }));

    expect(aplicarLance(cancelado, lanceAceito())).toBe(cancelado);
    expect(aplicarSuperado(cancelado, { loteId: ID, valorCentavos: 130_000 })).toBe(cancelado);
  });

  it('fim_estendido depois do fim é ignorado', () => {
    const final = encerrada();

    expect(aplicarFimEstendido(final, { loteId: ID, fimEm: FIM_MAIOR })).toBe(final);
  });
});

describe('estadoDaSala: fimEm só cresce', () => {
  it('fim_estendido com fim maior atualiza o fim e o aviso', () => {
    const novo = aplicarFimEstendido(sala(), { loteId: ID, fimEm: FIM_MAIOR });

    expect(novo.lote.fimEm).toBe(FIM_MAIOR);
    expect(novo.avisoFimEstendido).toMatch(/^O fim do lote foi estendido para /);
  });

  it('fim_estendido com fim menor ou igual não muda nada', () => {
    const atual = sala({ fimEm: FIM_MAIOR });

    expect(aplicarFimEstendido(atual, { loteId: ID, fimEm: FIM_MENOR })).toBe(atual);
    expect(aplicarFimEstendido(atual, { loteId: ID, fimEm: FIM_MAIOR })).toBe(atual);
  });

  it('lance_aceito com fimEm menor mantém o maior, mas aplica o lance', () => {
    const atual = sala({ fimEm: FIM_MAIOR });

    const novo = aplicarLance(atual, lanceAceito({ fimEm: FIM_MENOR }));

    expect(novo.lote.fimEm).toBe(FIM_MAIOR);
    expect(novo.lote.totalLances).toBe(4);
  });

  it('lance_aceito seguido de fim_estendido (mesmo fimEm) preenche o aviso', () => {
    const aposLance = aplicarLance(sala(), lanceAceito({ fimEm: FIM_MAIOR }));
    expect(aposLance.avisoFimEstendido).toBe('');

    const novo = aplicarFimEstendido(aposLance, { loteId: ID, fimEm: FIM_MAIOR });

    expect(novo).not.toBe(aposLance);
    expect(novo.lote.fimEm).toBe(FIM_MAIOR);
    expect(novo.avisoFimEstendido).toMatch(/^O fim do lote foi estendido para /);
  });

  it('fim_estendido seguido de lance_aceito (ordem inversa) mantém o aviso e o fim', () => {
    const aposFim = aplicarFimEstendido(sala(), { loteId: ID, fimEm: FIM_MAIOR });

    const novo = aplicarLance(aposFim, lanceAceito({ fimEm: FIM_MAIOR }));

    expect(novo.lote.fimEm).toBe(FIM_MAIOR);
    expect(novo.lote.totalLances).toBe(4);
    expect(novo.avisoFimEstendido).toBe(aposFim.avisoFimEstendido);
    expect(novo.avisoFimEstendido).not.toBe('');
  });

  it('fim_estendido repetido depois do lance_aceito não muda o estado', () => {
    const aposLance = aplicarLance(sala(), lanceAceito({ fimEm: FIM_MAIOR }));
    const anunciado = aplicarFimEstendido(aposLance, { loteId: ID, fimEm: FIM_MAIOR });

    expect(aplicarFimEstendido(anunciado, { loteId: ID, fimEm: FIM_MAIOR })).toBe(anunciado);
  });

  it('uma segunda extensão (fim maior) volta a anunciar', () => {
    const fimTres = '2026-10-25T14:12:03Z';
    const primeira = aplicarFimEstendido(aplicarLance(sala(), lanceAceito({ fimEm: FIM_MAIOR })), {
      loteId: ID,
      fimEm: FIM_MAIOR,
    });
    const aposSegundoLance = aplicarLance(
      primeira,
      lanceAceito({ seq: 5, totalLances: 5, fimEm: fimTres }),
    );

    const segunda = aplicarFimEstendido(aposSegundoLance, { loteId: ID, fimEm: fimTres });

    expect(segunda).not.toBe(aposSegundoLance);
    expect(segunda.avisoFimEstendido).not.toBe(primeira.avisoFimEstendido);
    expect(segunda.lote.fimEm).toBe(fimTres);
  });

  it('estado do resync já estendido não anuncia o mesmo fim de novo', () => {
    const resync = sala({ fimEm: FIM_MAIOR });

    expect(aplicarFimEstendido(resync, { loteId: ID, fimEm: FIM_MAIOR })).toBe(resync);
    expect(resync.avisoFimEstendido).toBe('');
  });

  it('lance_aceito com fimEm maior estende o fim', () => {
    const novo = aplicarLance(sala(), lanceAceito({ fimEm: FIM_MAIOR }));

    expect(novo.lote.fimEm).toBe(FIM_MAIOR);
    expect(FIM).not.toBe(FIM_MAIOR);
  });
});
