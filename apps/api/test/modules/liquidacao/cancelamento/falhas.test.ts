// Tradução das falhas da transação do cancelamento (tarefa 106; specs/010 §Cancelamento):
// contenção de lock (55P03) e consulta longa (57014) viram 503 INDISPONIVEL sem detalhes; a
// recusa de `cancelarLote` (ESTADO_INVALIDO, FIM_VENCIDO) vira 409 LOTE_ENCERRADO; o resto segue
// como veio (500 no filtro).
import { describe, expect, it } from 'vitest';

import { ErroApi } from '../../../../src/common/erros/erro-api.js';
import { ErroDoBanco } from '../../../../src/db/banco.js';
import {
  paraLote,
  traduzirFalhaDoCancelamento,
} from '../../../../src/modules/liquidacao/cancelamento/falhas.js';
import { ErroDeLote } from '../../../../src/modules/lotes/index.js';

function erroDoBanco(codigo: string): ErroDoBanco {
  return new ErroDoBanco({ codigo, restricao: undefined, tabela: undefined, coluna: undefined });
}

describe('traduzirFalhaDoCancelamento', () => {
  it.each(['55P03', '57014'])('SQLSTATE %s → 503 INDISPONIVEL sem detalhes', (codigo) => {
    const traduzido = traduzirFalhaDoCancelamento(erroDoBanco(codigo));

    expect(traduzido).toBeInstanceOf(ErroApi);
    expect(traduzido).toMatchObject({ codigo: 'INDISPONIVEL', status: 503, detalhes: undefined });
  });

  it.each(['ESTADO_INVALIDO', 'FIM_VENCIDO'] as const)(
    'ErroDeLote %s → 409 LOTE_ENCERRADO',
    (codigo) => {
      const traduzido = traduzirFalhaDoCancelamento(new ErroDeLote(codigo, 'lote'));

      expect(traduzido).toMatchObject({ codigo: 'LOTE_ENCERRADO', status: 409 });
    },
  );

  it('outros erros seguem como vieram', () => {
    const outro = new Error('qualquer');
    const unico = erroDoBanco('23505');

    expect(traduzirFalhaDoCancelamento(outro)).toBe(outro);
    expect(traduzirFalhaDoCancelamento(unico)).toBe(unico);
  });

  it('ErroDeLote que o cancelamento não produz (ARREMATE_INCOERENTE) segue como veio (500)', () => {
    const incoerente = new ErroDeLote('ARREMATE_INCOERENTE', 'lote');

    expect(traduzirFalhaDoCancelamento(incoerente)).toBe(incoerente);
  });
});

describe('paraLote', () => {
  it('monta o Lote do contrato sem liderId nem vencedorId', () => {
    const criadoEm = new Date('2026-10-27T13:50:00.000Z');
    const lote = paraLote({
      id: 'id-do-lote',
      titulo: 'Black Lotus',
      status: 'cancelado',
      cartaNome: 'Black Lotus',
      raridade: 'rare',
      snapshotId: 'id-do-snapshot',
      inicioEm: new Date('2026-10-27T14:00:00.000Z'),
      fimEm: new Date('2026-10-27T14:30:00.000Z'),
      fimOriginalEm: new Date('2026-10-27T14:30:00.000Z'),
      lanceInicialCentavos: 10000,
      incrementoMinimoCentavos: 1500,
      lanceAtualCentavos: null,
      totalLances: 0,
      valorArremateCentavos: null,
      criadoEm,
      liderId: 'id-de-usuario',
      vencedorId: null,
    });

    expect(lote).toEqual({
      id: 'id-do-lote',
      titulo: 'Black Lotus',
      status: 'cancelado',
      cartaNome: 'Black Lotus',
      raridade: 'rare',
      imagemUrl: '/api/imagens/id-do-snapshot',
      inicioEm: '2026-10-27T14:00:00.000Z',
      fimEm: '2026-10-27T14:30:00.000Z',
      lanceInicialCentavos: 10000,
      incrementoMinimoCentavos: 1500,
      lanceAtualCentavos: null,
      precoAtualCentavos: 10000,
      totalLances: 0,
      valorArremateCentavos: null,
      criadoEm: '2026-10-27T13:50:00.000Z',
    });
  });
});
