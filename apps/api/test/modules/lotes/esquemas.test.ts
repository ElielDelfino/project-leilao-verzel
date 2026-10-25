// Unidades da validação da criação de lote (specs/006 §Criação): cada fronteira, a ordem do
// "primeiro campo inválido" e o título padrão, com um "agora" fixo (sem rede nem banco).
import { describe, expect, it } from 'vitest';

import { ErroApi } from '../../../src/common/erros/erro-api.js';
import {
  esquemaDaPaginaDoPainel,
  PipeDaPaginaDoPainel,
  tituloDoLote,
  validarNovoLote,
} from '../../../src/modules/lotes/esquemas.js';

const AGORA = Date.parse('2026-10-25T12:00:00.000Z');
const SEGUNDO = 1000;
const MINUTO = 60 * SEGUNDO;
const DIA = 24 * 60 * MINUTO;
const ID = '0f3c5f1e-8e2a-4a8b-9b6e-2f1d0c9a7b65';

const iso = (ms: number): string => new Date(ms).toISOString();

function corpo(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    scryfallId: ID,
    lanceInicialCentavos: 100,
    incrementoMinimoCentavos: 100,
    inicioEm: iso(AGORA),
    fimEm: iso(AGORA + DIA),
    ...extra,
  };
}

function campoInvalido(entrada: unknown): string | undefined {
  const r = validarNovoLote(entrada, AGORA);
  return r.ok ? undefined : r.campo;
}

describe('validarNovoLote', () => {
  it('aceita o corpo mínimo e devolve datas, título e descrição nulos', () => {
    const r = validarNovoLote(corpo(), AGORA);
    expect(r).toEqual({
      ok: true,
      dados: {
        scryfallId: ID,
        titulo: null,
        descricao: null,
        lanceInicialCentavos: 100,
        incrementoMinimoCentavos: 100,
        inicioEm: new Date(AGORA),
        fimEm: new Date(AGORA + DIA),
      },
    });
  });

  it.each([
    ['título de 120 caracteres', { titulo: 'a'.repeat(120) }, undefined],
    ['título de 121 caracteres', { titulo: 'a'.repeat(121) }, 'titulo'],
    ['título de 120 emojis (conta code points)', { titulo: '🃏'.repeat(120) }, undefined],
    ['título vazio', { titulo: '' }, 'titulo'],
    ['título não string', { titulo: 7 }, 'titulo'],
    ['descrição de 2000 caracteres', { descricao: 'd'.repeat(2000) }, undefined],
    ['descrição de 2001 caracteres', { descricao: 'd'.repeat(2001) }, 'descricao'],
    ['descrição vazia', { descricao: '' }, undefined],
    ['lance de 99 centavos', { lanceInicialCentavos: 99 }, 'lanceInicialCentavos'],
    ['lance de 100.000.000', { lanceInicialCentavos: 100_000_000 }, undefined],
    ['lance de 100.000.001', { lanceInicialCentavos: 100_000_001 }, 'lanceInicialCentavos'],
    ['lance fracionário', { lanceInicialCentavos: 100.5 }, 'lanceInicialCentavos'],
    ['lance em string', { lanceInicialCentavos: '100' }, 'lanceInicialCentavos'],
    ['incremento de 99', { incrementoMinimoCentavos: 99 }, 'incrementoMinimoCentavos'],
    ['incremento de 100.000.000', { incrementoMinimoCentavos: 100_000_000 }, undefined],
    [
      'incremento de 100.000.001',
      { incrementoMinimoCentavos: 100_000_001 },
      'incrementoMinimoCentavos',
    ],
    ['scryfallId que não é UUID', { scryfallId: 'abc' }, 'scryfallId'],
    ['início sem fuso', { inicioEm: '2026-10-25T12:00:00' }, 'inicioEm'],
    ['início que não é data', { inicioEm: 'amanhã' }, 'inicioEm'],
    ['fim ausente', { fimEm: undefined }, 'fimEm'],
  ])('%s', (_caso, extra, esperado) => {
    expect(campoInvalido(corpo(extra))).toBe(esperado);
  });

  it('início com fuso ±hh:mm é aceito', () => {
    const inicio = '2026-10-25T09:00:00-03:00';
    expect(campoInvalido(corpo({ inicioEm: inicio, fimEm: iso(AGORA + MINUTO * 10) }))).toBe(
      undefined,
    );
  });

  it('início = agora − 1 min é aceito; agora − 61 s é recusado', () => {
    const umMinuto = AGORA - MINUTO;
    expect(campoInvalido(corpo({ inicioEm: iso(umMinuto), fimEm: iso(umMinuto + DIA) }))).toBe(
      undefined,
    );
    const passado = AGORA - 61 * SEGUNDO;
    expect(campoInvalido(corpo({ inicioEm: iso(passado), fimEm: iso(passado + DIA) }))).toBe(
      'inicioEm',
    );
  });

  it.each([
    ['fim 299 s depois do início', 299 * SEGUNDO, 'fimEm'],
    ['fim 300 s depois do início', 300 * SEGUNDO, undefined],
    ['duração de 7 dias', 7 * DIA, undefined],
    ['duração de 7 dias + 1 s', 7 * DIA + SEGUNDO, 'fimEm'],
    ['fim antes do início', -MINUTO, 'fimEm'],
  ])('%s', (_caso, duracao, esperado) => {
    expect(campoInvalido(corpo({ fimEm: iso(AGORA + duracao) }))).toBe(esperado);
  });

  it('o primeiro campo inválido na ordem do corpo é o reportado', () => {
    const tudoErrado = {
      scryfallId: 'x',
      titulo: '',
      descricao: 'd'.repeat(2001),
      lanceInicialCentavos: 1,
      incrementoMinimoCentavos: 1,
      inicioEm: 'x',
      fimEm: 'x',
    };
    expect(campoInvalido(tudoErrado)).toBe('scryfallId');
    expect(campoInvalido({ ...tudoErrado, scryfallId: ID })).toBe('titulo');
    expect(campoInvalido({ ...tudoErrado, scryfallId: ID, titulo: null })).toBe('descricao');
    expect(campoInvalido({ ...corpo(), lanceInicialCentavos: 1, inicioEm: iso(AGORA - DIA) })).toBe(
      'lanceInicialCentavos',
    );
  });

  it('campo desconhecido e corpo que não é objeto → 422 com campo', () => {
    expect(campoInvalido(corpo({ leiloeiroId: ID }))).toBe('leiloeiroId');
    expect(campoInvalido(corpo({ ['x'.repeat(65)]: 1 }))).toBe('corpo');
    expect(campoInvalido(corpo({ 'nome com espaço': 1 }))).toBe('corpo');
    expect(campoInvalido(null)).toBe('corpo');
    expect(campoInvalido([corpo()])).toBe('corpo');
    expect(campoInvalido('texto')).toBe('corpo');
  });

  it('título e descrição perdem os espaços das pontas; só espaços → null', () => {
    const r = validarNovoLote(corpo({ titulo: '  Meu lote  ', descricao: '  linha  ' }), AGORA);
    expect(r.ok && r.dados.titulo).toBe('Meu lote');
    expect(r.ok && r.dados.descricao).toBe('linha');
    const vazio = validarNovoLote(corpo({ titulo: '   ', descricao: '  ' }), AGORA);
    expect(vazio.ok && [vazio.dados.titulo, vazio.dados.descricao]).toEqual([null, null]);
  });
});

describe('tituloDoLote', () => {
  it('usa o título informado ou o nome da carta truncado em 120 code points', () => {
    expect(tituloDoLote('Meu', 'Lightning Bolt')).toBe('Meu');
    expect(tituloDoLote(null, 'Lightning Bolt')).toBe('Lightning Bolt');
    expect(tituloDoLote(null, '🃏'.repeat(130))).toBe('🃏'.repeat(120));
  });
});

describe('pagina do painel', () => {
  const pipe = new PipeDaPaginaDoPainel(esquemaDaPaginaDoPainel);

  it('ausente → 1; 500 aceita', () => {
    expect(pipe.transform(undefined)).toBe(1);
    expect(pipe.transform('500')).toBe(500);
  });

  it.each(['0', '501', '01', 'a', '', '1.5'])('%s → 422 com campo pagina', (valor) => {
    let erro: unknown;
    try {
      pipe.transform(valor);
    } catch (e: unknown) {
      erro = e;
    }
    expect(erro).toBeInstanceOf(ErroApi);
    expect((erro as ErroApi).detalhes).toEqual({ campo: 'pagina' });
    expect((erro as ErroApi).status).toBe(422);
  });
});
