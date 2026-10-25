import { Module } from '@nestjs/common';

import { CarteiraController } from './carteira.controller.js';
import { ServicoDeCarteira } from './servico-de-carteira.js';

/**
 * Módulo carteira (specs/004): dono de `ledger_entries` e `wallet_balances`. Depende do provider
 * global BANCO (AppModule). Na F1 nenhum outro módulo chama a carteira; a interface
 * `carteira.*(tx, ...)` para lances, liquidação e cancelamento entra nas fases F3 e F4.
 */
@Module({
  controllers: [CarteiraController],
  providers: [ServicoDeCarteira],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- módulo Nest: o conteúdo vem do decorator
export class CarteiraModule {}
