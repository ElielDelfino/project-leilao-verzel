// Unidade: forma canônica JCS do subconjunto do lance e do selo (specs/008 §Forma canônica, ADR 0031 D2).
import { describe, expect, it } from 'vitest';

import {
  canonicalizar,
  ErroDeCanonico,
  type ObjetoCanonico,
} from '../../../../src/modules/lances/integridade/canonico.js';

describe('canonicalizar: vetores do RFC 8785 no subconjunto (chaves, inteiros, ASCII, null)', () => {
  it('ordena as chaves por unidades UTF-16 (RFC 8785 §3.2.3, parte ASCII do exemplo)', () => {
    expect(canonicalizar({ '1': 'One', '\r': 'Carriage Return' })).toBe(
      '{"\\r":"Carriage Return","1":"One"}',
    );
  });

  it('ordena maiúsculas antes de minúsculas e prefixo antes da chave maior', () => {
    expect(canonicalizar({ b: 1, a: 2, B: 3, aa: 4 })).toBe('{"B":3,"a":2,"aa":4,"b":1}');
  });

  it('serializa a string ASCII do exemplo do RFC 8785 §3.2.2.2 com os escapes da JCS', () => {
    // Valor do RFC sem o "€": $, U+000F, LF, A, ', B, ", \, \, ", /.
    const valor = ['$', '\u000f', '\n', 'A', "'", 'B', '"', '\\', '\\', '"', '/'].join('');
    expect(canonicalizar({ string: valor })).toBe(String.raw`{"string":"$\u000f\nA'B\"\\\\\"/"}`);
  });

  it('usa os escapes curtos e \\u00xx minúsculo para controles (RFC 8785 §3.2.2.2)', () => {
    expect(canonicalizar({ s: '\b\t\n\f\r\u001f' })).toBe('{"s":"\\b\\t\\n\\f\\r\\u001f"}');
  });

  it('serializa inteiros como no RFC 8785 Apêndice B (0, -0 e 2^53 - 1)', () => {
    expect(canonicalizar({ a: 0, b: -0, c: 9007199254740991, d: -9007199254740991 })).toBe(
      '{"a":0,"b":0,"c":9007199254740991,"d":-9007199254740991}',
    );
  });

  it('serializa null como literal e mantém a chave', () => {
    expect(canonicalizar({ vencedor: null, total: 0 })).toBe('{"total":0,"vencedor":null}');
  });

  it('serializa o objeto vazio', () => {
    expect(canonicalizar({})).toBe('{}');
  });

  it('não depende da ordem de inserção das chaves', () => {
    expect(canonicalizar({ z: 'a', m: 1, a: null })).toBe(canonicalizar({ a: null, m: 1, z: 'a' }));
  });
});

describe('canonicalizar: recusa o que está fora do subconjunto', () => {
  it.each([
    ['número com fração', { v: 1.5 }],
    ['inteiro acima de 2^53 - 1', { v: 9007199254740992 }],
    ['NaN', { v: Number.NaN }],
    ['Infinity', { v: Number.POSITIVE_INFINITY }],
    ['booleano', { v: true }],
    ['objeto aninhado', { v: { a: 1 } }],
    ['array', { v: [1] }],
    ['undefined', { v: undefined }],
    ['bigint', { v: 1n }],
    ['string não ASCII', { v: 'Licitante €' }],
    ['chave não ASCII', { ö: 1 }],
  ])('%s', (_nome, objeto) => {
    expect(() => canonicalizar(objeto as unknown as ObjetoCanonico)).toThrow(ErroDeCanonico);
  });

  it('a mensagem do erro cita a chave e não o valor', () => {
    expect(() => canonicalizar({ segredo: 'texto-sigiloso-é' })).toThrow(/segredo/);
    expect(() => canonicalizar({ segredo: 'texto-sigiloso-é' })).not.toThrow(/sigiloso/);
  });
});
