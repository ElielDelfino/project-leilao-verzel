import { Module } from '@nestjs/common';

import { CatalogoController } from './catalogo.controller.js';
import { provedorDoClienteScryfall } from './scryfall/scryfall.provider.js';
import { ServicoDeCatalogo } from './servico-de-catalogo.js';

/**
 * Módulo catalogo (specs/005): dono de `card_snapshots` e das chaves Redis `scryfall:*`. BANCO,
 * CLIENTE_REDIS e ENV vêm dos módulos globais (BancoModule, RedisModule e AppModule). Exporta só
 * o ServicoDeCatalogo, a interface pública que lotes e liquidacao usam (index.ts).
 */
@Module({
  controllers: [CatalogoController],
  providers: [provedorDoClienteScryfall, ServicoDeCatalogo],
  exports: [ServicoDeCatalogo],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- módulo Nest: o conteúdo vem do decorator
export class CatalogoModule {}
