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
  haLacunaDeSeq,
  mesclarResync,
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

describe('estadoDaSala: fim só avança', () => {
  it('fim_estendido atrasado (fim menor que o exibido) não recua o fim', () => {
    const base = aplicarLance(sala(), lanceAceito({ fimEm: FIM_MAIOR }));

    const depois = aplicarFimEstendido(base, { loteId: ID, fimEm: '2026-10-25T14:04:00Z' });

    expect(depois.lote.fimEm).toBe(FIM_MAIOR);
  });

  it('fim_estendido igual ao exibido não muda o fim', () => {
    const base = aplicarLance(sala(), lanceAceito({ fimEm: FIM_MAIOR }));

    expect(aplicarFimEstendido(base, { loteId: ID, fimEm: FIM_MAIOR }).lote.fimEm).toBe(FIM_MAIOR);
  });
});

describe('estadoDaSala: lacuna de seq', () => {
  it('seq maior que o último + 1 é lacuna; o seguinte, repetido ou menor não', () => {
    const base = sala();

    expect(haLacunaDeSeq(base, lanceAceito({ seq: 5 }))).toBe(true);
    expect(haLacunaDeSeq(base, lanceAceito({ seq: 4 }))).toBe(false);
    expect(haLacunaDeSeq(base, lanceAceito({ seq: 3 }))).toBe(false);
    expect(haLacunaDeSeq(base, lanceAceito({ seq: 1 }))).toBe(false);
  });

  it('sem lances o último é 0: seq 1 é o seguinte e seq 2 é lacuna', () => {
    const vazio = sala({ lanceAtualCentavos: null, totalLances: 0 }, { ultimosLances: [] });

    expect(haLacunaDeSeq(vazio, lanceAceito({ seq: 1 }))).toBe(false);
    expect(haLacunaDeSeq(vazio, lanceAceito({ seq: 2 }))).toBe(true);
  });

  it('lacuna não é aplicada ao estado', () => {
    const base = sala();

    expect(aplicarLance(base, lanceAceito({ seq: 6, totalLances: 6 }))).toBe(base);
  });

  it('sala terminal não tem lacuna', () => {
    expect(haLacunaDeSeq(encerrada(), lanceAceito({ seq: 9 }))).toBe(false);
  });
});

describe('estadoDaSala: resync preserva o aviso de fim estendido', () => {
  const agora = Date.parse('2026-10-25T12:00:00Z');
  const resposta = (fimEm: string) => criarEstadoDaSala(criarEstado({ fimEm }), agora);

  it('fimEm igual mantém aviso e marca anunciada, sem pedir novo selo', () => {
    const anterior = aplicarFimEstendido(sala(), { loteId: ID, fimEm: FIM_MAIOR });

    const mesclado = mesclarResync(anterior, resposta(FIM_MAIOR));

    expect(mesclado.estado.avisoFimEstendido).toBe(anterior.avisoFimEstendido);
    expect(mesclado.estado.avisoFimEstendido).not.toBe('');
    expect(mesclado.novaExtensao).toBe(false);
  });

  it('fimEm maior anuncia a extensão uma vez e pede o selo', () => {
    const anterior = sala();

    const mesclado = mesclarResync(anterior, resposta(FIM_MAIOR));

    expect(mesclado.estado.avisoFimEstendido).toMatch(/^O fim do lote foi estendido para /);
    expect(mesclado.novaExtensao).toBe(true);
    // O mesmo fim depois do resync é repetido: o fim_estendido seguinte não anuncia de novo.
    const repetido = aplicarFimEstendido(mesclado.estado, { loteId: ID, fimEm: FIM_MAIOR });
    expect(repetido).toBe(mesclado.estado);
  });

  it('fimEm menor do resync não apaga o aviso nem recua o anunciado', () => {
    const anterior = aplicarFimEstendido(sala(), { loteId: ID, fimEm: FIM_MAIOR });

    const mesclado = mesclarResync(anterior, resposta(FIM_MENOR));

    expect(mesclado.estado.avisoFimEstendido).toBe(anterior.avisoFimEstendido);
    expect(mesclado.estado.fimAnunciadoEm).toBe(FIM_MAIOR);
    expect(mesclado.novaExtensao).toBe(false);
  });

  it('sem estado anterior (primeira entrada) nunca anuncia', () => {
    const mesclado = mesclarResync(null, resposta(FIM_MAIOR));

    expect(mesclado.estado.avisoFimEstendido).toBe('');
    expect(mesclado.novaExtensao).toBe(false);
  });
});
