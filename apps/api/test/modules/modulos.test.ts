import { describe, expect, it } from 'vitest';

import { AppModule } from '../../src/app.module.js';
import { CarteiraModule } from '../../src/modules/carteira/index.js';
import { CatalogoModule } from '../../src/modules/catalogo/index.js';
import { IdentidadeModule } from '../../src/modules/identidade/index.js';
import { LancesModule } from '../../src/modules/lances/index.js';
import { LiquidacaoModule } from '../../src/modules/liquidacao/index.js';
import { LotesModule } from '../../src/modules/lotes/index.js';
import { TempoRealModule } from '../../src/modules/tempo-real/index.js';
import { ENV_DE_TESTE } from '../helpers/app-de-teste.js';

// specs/001 §Módulos da API: os 7 módulos, cada um com a interface pública em index.ts.
const MODULOS_DA_SPEC = [
  IdentidadeModule,
  CarteiraModule,
  CatalogoModule,
  LotesModule,
  LancesModule,
  TempoRealModule,
  LiquidacaoModule,
];

describe('módulos da API (specs/001 §Módulos da API)', () => {
  it('cada um dos 7 módulos é uma classe exportada pelo index.ts', () => {
    expect(new Set(MODULOS_DA_SPEC).size).toBe(7);
    for (const modulo of MODULOS_DA_SPEC) {
      expect(typeof modulo).toBe('function');
    }
  });

  it('o AppModule importa os 7 módulos', () => {
    const importados = AppModule.registrar(ENV_DE_TESTE).imports ?? [];

    for (const modulo of MODULOS_DA_SPEC) {
      expect(importados).toContain(modulo);
    }
  });
});
