import { type INestApplicationContext, Module } from '@nestjs/common';

import { CadeiaDeLances } from './cadeia.js';
import { ServicoDeChaves } from './chaves.js';
import { LancesController } from './lances.controller.js';
import { LeiturasDeLances } from './leituras-de-lances.js';
import { HistoricoDeLancesController, MeusLancesController } from './leituras.controller.js';
import { ServicoDeLances } from './servico-de-lances.js';

/**
 * Módulo lances (specs/007, specs/008): dono de `bids`, `lot_seals` e `signing_keys`. Depende dos
 * providers globais BANCO, ENV, LimiteDeTentativas e PublicadorDeEventos (AppModule). Outros
 * módulos usam só `CadeiaDeLances` (anexar e selar) e `LeiturasDeLances` (posição, últimos
 * lances e pseudônimo, para o estado da sala).
 */
@Module({
  controllers: [LancesController, HistoricoDeLancesController, MeusLancesController],
  providers: [ServicoDeChaves, CadeiaDeLances, ServicoDeLances, LeiturasDeLances],
  exports: [CadeiaDeLances, LeiturasDeLances],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- módulo Nest: o conteúdo vem do decorator
export class LancesModule {}

/**
 * Registra a chave pública ativa em `signing_keys` (specs/008 §Chaves). O boot (main.ts) chama
 * antes do `listen` e a falha impede a API de subir. Fica fora dos hooks do Nest de propósito: as
 * apps de teste sobem com o Postgres falso ou fora, e a assinatura recusa até o registro.
 */
export async function registrarChaveDeAssinatura(app: INestApplicationContext): Promise<void> {
  await app.get(ServicoDeChaves).registrar();
}
