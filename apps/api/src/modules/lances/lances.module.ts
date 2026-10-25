import { type INestApplicationContext, Module } from '@nestjs/common';

import { CadeiaDeLances } from './cadeia.js';
import { ServicoDeChaves } from './chaves.js';

/**
 * Módulo lances (specs/007, specs/008): dono de `bids`, `lot_seals` e `signing_keys`. Depende dos
 * providers globais BANCO e ENV. Outros módulos usam só `CadeiaDeLances` (anexar e selar).
 */
@Module({
  providers: [ServicoDeChaves, CadeiaDeLances],
  exports: [CadeiaDeLances],
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
