import { afterEach, describe, expect, it } from 'vitest';

import { criarAdaptadorFastify } from '../src/app.js';
import { criarLogger } from '../src/logger/logger.js';

describe('criarAdaptadorFastify', () => {
  const avisos: Error[] = [];
  const ouvir = (aviso: Error): void => {
    avisos.push(aviso);
  };

  afterEach(() => {
    process.off('warning', ouvir);
  });

  it('não usa opções obsoletas do Fastify (FSTDEP023/FSTDEP024)', async () => {
    process.on('warning', ouvir);

    const adaptador = criarAdaptadorFastify(criarLogger('silent'));
    await adaptador.getInstance().ready();
    await adaptador.close();
    // process.emitWarning é assíncrono: espera o próximo ciclo para recolher os avisos.
    await new Promise((resolver) => setImmediate(resolver));

    const codigos = avisos.map((aviso) => (aviso as Error & { code?: string }).code);
    expect(codigos).not.toContain('FSTDEP023');
    expect(codigos).not.toContain('FSTDEP024');
  });
});
