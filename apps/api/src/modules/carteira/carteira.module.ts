import { Module } from '@nestjs/common';

import { CarteiraController } from './carteira.controller.js';
import { ServicoDeCarteira } from './servico-de-carteira.js';

/**
 * Módulo carteira (specs/004): dono de `ledger_entries` e `wallet_balances`. Depende do provider
 * global BANCO (AppModule). Outros módulos usam as funções `(tx, ...)` exportadas por index.ts
 * (comprometer, liberar, travarCarteiras; tarefa 074); liquidação e estorno entram na F4.
 */
@Module({
  controllers: [CarteiraController],
  providers: [ServicoDeCarteira],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- módulo Nest: o conteúdo vem do decorator
export class CarteiraModule {}
