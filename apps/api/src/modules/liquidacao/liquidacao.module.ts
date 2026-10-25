import { Module } from '@nestjs/common';

import { AgendadorModule } from './agendador/agendador.module.js';
import { CancelamentoModule } from './cancelamento/cancelamento.module.js';
import { ComprovantesModule } from './comprovantes/comprovantes.module.js';
import { EncerramentoModule } from './encerramento/encerramento.module.js';

/**
 * Módulo liquidacao (specs/010, specs/011): dono de `receipts`. Cada caso de uso vive num
 * submódulo na própria pasta (encerramento 105, cancelamento 106, comprovantes 107, agendador
 * 109), para que as tarefas seguintes não disputem este arquivo.
 */
@Module({
  imports: [EncerramentoModule, CancelamentoModule, ComprovantesModule, AgendadorModule],
  exports: [EncerramentoModule, AgendadorModule],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- módulo Nest: o conteúdo vem do decorator
export class LiquidacaoModule {}
