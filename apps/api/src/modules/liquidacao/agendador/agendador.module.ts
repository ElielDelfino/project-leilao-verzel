import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { EncerramentoModule } from '../encerramento/encerramento.module.js';
import { AgendadorDoEncerramento } from './agendador-do-encerramento.js';

/**
 * Agendador de 1 s: início e encerramento dos lotes (specs/010 §Comportamento, tarefa 107).
 * Nada liga sozinho: o `main.ts` chama `iniciar()` depois do `listen` e `parar()` no shutdown.
 * `ScheduleModule` só fornece o `SchedulerRegistry`; não há `@Interval` nem `@Cron`.
 */
@Module({
  imports: [ScheduleModule.forRoot(), EncerramentoModule],
  providers: [AgendadorDoEncerramento],
  exports: [AgendadorDoEncerramento],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- módulo Nest: o conteúdo vem do decorator
export class AgendadorModule {}
