import { describe, expect, it } from 'vitest';

import { formatarData, formatarDataHora } from '../../src/formatacao/data';

describe('formatarDataHora', () => {
  it('converte de UTC para America/Sao_Paulo (UTC-3)', () => {
    expect(formatarDataHora('2026-10-24T13:00:00Z')).toBe('24/10/2026, 10:00');
  });

  it('muda o dia quando a hora em UTC já passou da meia-noite', () => {
    expect(formatarDataHora('2026-10-25T02:30:00Z')).toBe('24/10/2026, 23:30');
  });

  it('aceita Date', () => {
    expect(formatarDataHora(new Date('2026-01-01T03:00:00Z'))).toBe('01/01/2026, 00:00');
  });

  it('recusa data inválida', () => {
    expect(() => formatarDataHora('não é data')).toThrow(RangeError);
  });
});

describe('formatarData', () => {
  it('mostra só o dia em America/Sao_Paulo', () => {
    expect(formatarData('2026-10-25T02:30:00Z')).toBe('24/10/2026');
  });

  it('recusa data inválida', () => {
    expect(() => formatarData(new Date(Number.NaN))).toThrow(RangeError);
  });
});
