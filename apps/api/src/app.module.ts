import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';

import { FiltroDeExcecoes } from './common/erros/filtro-de-excecoes.js';
import { EventosModule } from './common/eventos/eventos.module.js';
import { LimiteModule } from './common/limite/limite.module.js';
import { BancoModule } from './config/banco.module.js';
import { ENV, type Env } from './config/env.js';
import { HealthModule } from './health/health.module.js';
import { CarteiraModule } from './modules/carteira/index.js';
import { CatalogoModule } from './modules/catalogo/index.js';
import { IdentidadeModule } from './modules/identidade/index.js';
import { LancesModule } from './modules/lances/index.js';
import { LiquidacaoModule } from './modules/liquidacao/index.js';
import { LotesModule } from './modules/lotes/index.js';
import { TempoRealModule } from './modules/tempo-real/index.js';
import { RedisModule } from './redis/redis.module.js';

/**
 * Raiz do monolito modular (ADR 0003): os providers globais (Banco, Redis, rate limit), os 7
 * módulos de specs/001, health e o filtro global.
 */
@Module({})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- padrão de módulo dinâmico do Nest (registrar)
export class AppModule {
  /** Recebe o env já validado no boot e o expõe a todos os módulos pelo token ENV. */
  static registrar(env: Env): DynamicModule {
    return {
      module: AppModule,
      global: true,
      imports: [
        BancoModule,
        RedisModule,
        LimiteModule,
        EventosModule,
        IdentidadeModule,
        CarteiraModule,
        CatalogoModule,
        LotesModule,
        LancesModule,
        TempoRealModule,
        LiquidacaoModule,
        HealthModule,
      ],
      providers: [
        { provide: ENV, useValue: env },
        { provide: APP_FILTER, useClass: FiltroDeExcecoes },
      ],
      exports: [ENV],
    };
  }
}
