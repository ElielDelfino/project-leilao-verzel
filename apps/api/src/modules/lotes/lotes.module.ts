import { Module } from '@nestjs/common';

import { CatalogoModule } from '../catalogo/index.js';
import { PainelController } from './painel.controller.js';
import { ServicoDeLotes } from './servico-de-lotes.js';

/**
 * Módulo lotes (specs/006): dono de `lots`. Usa só a interface pública de catalogo (snapshot em
 * duas etapas); BANCO vem do módulo global BancoModule.
 */
@Module({
  imports: [CatalogoModule],
  controllers: [PainelController],
  providers: [ServicoDeLotes],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- módulo Nest: o conteúdo vem do decorator
export class LotesModule {}
