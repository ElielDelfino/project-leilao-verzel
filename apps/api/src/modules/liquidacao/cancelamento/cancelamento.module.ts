import { Module } from '@nestjs/common';

import { LancesModule } from '../../lances/index.js';
import { CancelamentoController } from './cancelamento.controller.js';
import { ServicoDeCancelamento } from './servico-de-cancelamento.js';

/**
 * Cancelamento de lote com estorno (specs/010 §Cancelamento, tarefa 106). Depende dos providers
 * globais BANCO e PublicadorDeEventos (AppModule) e de CadeiaDeLances (selo).
 */
@Module({
  imports: [LancesModule],
  controllers: [CancelamentoController],
  providers: [ServicoDeCancelamento],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- módulo Nest: o conteúdo vem do decorator
export class CancelamentoModule {}
