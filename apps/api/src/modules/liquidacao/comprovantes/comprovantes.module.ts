import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';

import { ComprovantesController } from './comprovantes.controller.js';
import { SemCacheMiddleware } from './sem-cache.middleware.js';
import { ServicoDeComprovantes } from './servico-de-comprovantes.js';

/**
 * Comprovante público e "meus arremates" (specs/011; tarefa 109). Usa os providers globais BANCO
 * e LimiteDeTentativas; a carta vem da interface pública de `lotes`.
 */
@Module({
  controllers: [ComprovantesController],
  providers: [ServicoDeComprovantes],
})
export class ComprovantesModule implements NestModule {
  configure(consumidor: MiddlewareConsumer): void {
    consumidor.apply(SemCacheMiddleware).forRoutes(ComprovantesController);
  }
}
