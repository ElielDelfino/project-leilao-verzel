// Unidade: tabela de posições de specs/007 §Posição do usuário no lote (ADR 0025) e o `pagina` das
// listas (PaginaLimitada: 1 a 500, sem zeros à esquerda).
import { describe, expect, it } from 'vitest';

import { ErroApi } from '../../../src/common/erros/erro-api.js';
import { PipeDaPaginaDeLances } from '../../../src/modules/lances/esquemas.js';
import { calcularPosicao, type LoteParaPosicao } from '../../../src/modules/lances/regras.js';

const EU = '0192f000-0000-7000-8000-000000000001';
const OUTRO = '0192f000-0000-7000-8000-000000000002';

function lote(extra: Partial<LoteParaPosicao>): LoteParaPosicao {
  return { status: 'ao_vivo', liderId: null, vencedorId: null, ...extra };
}

describe('calcularPosicao', () => {
  it('ganhando: lote ao vivo e o usuário lidera', () => {
    expect(calcularPosicao(lote({ liderId: EU }), EU, true)).toBe('ganhando');
  });

  it('superado: lote ao vivo, com lance, e outro lidera', () => {
    expect(calcularPosicao(lote({ liderId: OUTRO }), EU, true)).toBe('superado');
  });

  it('venceu: lote encerrado e o usuário é o vencedor', () => {
    const encerrado = lote({ status: 'encerrado', liderId: EU, vencedorId: EU });
    expect(calcularPosicao(encerrado, EU, true)).toBe('venceu');
  });

  it('perdeu: lote encerrado com outro vencedor', () => {
    const encerrado = lote({ status: 'encerrado', liderId: OUTRO, vencedorId: OUTRO });
    expect(calcularPosicao(encerrado, EU, true)).toBe('perdeu');
  });

  it('perdeu: lote cancelado, mesmo para quem liderava', () => {
    expect(calcularPosicao(lote({ status: 'cancelado', liderId: EU }), EU, true)).toBe('perdeu');
  });

  it('sem_lance: usuário sem lance no lote, em qualquer status', () => {
    for (const status of ['agendado', 'ao_vivo', 'encerrado', 'cancelado'] as const) {
      expect(calcularPosicao(lote({ status, liderId: OUTRO }), EU, false)).toBe('sem_lance');
    }
  });

  it('sem_lance: lote agendado (não aceita lance)', () => {
    expect(calcularPosicao(lote({ status: 'agendado' }), EU, true)).toBe('sem_lance');
  });

  it('encerrado sem vencedor gravado: ganhando para o líder', () => {
    const encerrado = lote({ status: 'encerrado', liderId: EU });
    expect(calcularPosicao(encerrado, EU, true)).toBe('ganhando');
  });

  it('encerrado sem vencedor gravado: perdeu para quem tem lance e não lidera', () => {
    const encerrado = lote({ status: 'encerrado', liderId: OUTRO });
    expect(calcularPosicao(encerrado, EU, true)).toBe('perdeu');
  });
});

describe('PipeDaPaginaDeLances', () => {
  const pipe = new PipeDaPaginaDeLances();

  it.each([
    [undefined, 1],
    ['1', 1],
    ['37', 37],
    ['500', 500],
  ])('aceita %j como página %i', (entrada, esperado) => {
    expect(pipe.transform(entrada)).toBe(esperado);
  });

  it.each([['0'], ['501'], ['999'], ['-1'], ['01'], ['1.5'], ['abc'], [''], ['1e2'], [['1', '2']]])(
    'recusa %j com 422 e detalhes.campo = pagina',
    (entrada) => {
      let erro: unknown;
      try {
        pipe.transform(entrada);
      } catch (e: unknown) {
        erro = e;
      }
      expect(erro).toBeInstanceOf(ErroApi);
      expect(erro).toMatchObject({
        codigo: 'DADOS_INVALIDOS',
        status: 422,
        detalhes: { campo: 'pagina' },
      });
    },
  );
});
