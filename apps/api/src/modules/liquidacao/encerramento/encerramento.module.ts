import { Module } from '@nestjs/common';

import { LancesModule } from '../../lances/index.js';
import { ServicoDeEncerramento } from './servico-de-encerramento.js';

/**
 * Encerramento e liquidação de um lote (specs/010, tarefa 105). Exporta o serviço para o
 * agendador (tarefa 109). Depende dos providers globais BANCO e PublicadorDeEventos (AppModule).
 */
@Module({
  imports: [LancesModule],
  providers: [ServicoDeEncerramento],
  exports: [ServicoDeEncerramento],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- módulo Nest: o conteúdo vem do decorator
export class EncerramentoModule {}
