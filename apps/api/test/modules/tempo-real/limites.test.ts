import { describe, expect, it } from 'vitest';

import { LimiteDeEventos, ReservaDeConexoes } from '../../../src/modules/tempo-real/limites.js';

describe('LimiteDeEventos', () => {
  it('deixa passar até o máximo da janela e recusa o excedente', () => {
    const limite = new LimiteDeEventos(3, 1_000);

    const resultados = [0, 10, 20, 30, 40].map((agora) => limite.permitir(agora));

    expect(resultados).toEqual([true, true, true, false, false]);
    expect(limite.totalRecusado).toBe(2);
  });

  it('abre uma janela nova depois de 1 s', () => {
    const limite = new LimiteDeEventos(2, 1_000);
    limite.permitir(0);
    limite.permitir(1);
    expect(limite.permitir(999)).toBe(false);

    expect(limite.permitir(1_000)).toBe(true);
    expect(limite.permitir(1_001)).toBe(true);
    expect(limite.permitir(1_002)).toBe(false);
  });

  it('não carrega o excedente para a janela seguinte', () => {
    const limite = new LimiteDeEventos(1, 1_000);
    for (let i = 0; i < 50; i += 1) limite.permitir(i);

    expect(limite.permitir(2_000)).toBe(true);
  });
});

describe('ReservaDeConexoes', () => {
  it('libera a vaga uma única vez, mesmo se a liberação for chamada de novo', () => {
    const reserva = new ReservaDeConexoes(1);
    const liberar = reserva.reservar();
    expect(liberar).toBeDefined();
    expect(reserva.reservar()).toBeUndefined();

    liberar?.();
    liberar?.();

    expect(reserva.emUso).toBe(0);
    expect(reserva.reservar()).toBeDefined();
  });
});
