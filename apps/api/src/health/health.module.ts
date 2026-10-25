import { Module } from '@nestjs/common';

import { BANCO } from '../config/banco.module.js';
import type { BancoVerificavel } from '../db/banco.js';
import type { ClienteRedis } from '../redis/cliente.js';
import { CLIENTE_REDIS } from '../redis/redis.module.js';
import { HealthController } from './health.controller.js';
import {
  ServicoDeProntidao,
  VERIFICACOES_DE_PRONTIDAO,
  type VerificacaoDeProntidao,
} from './prontidao.js';
import { verificacaoDoPostgres, verificacaoDoRedis } from './verificacoes.js';

function verificacoesRegistradas(
  banco: BancoVerificavel,
  redis: ClienteRedis,
): readonly VerificacaoDeProntidao[] {
  return [verificacaoDoPostgres(banco), verificacaoDoRedis(redis)];
}

// BANCO e CLIENTE_REDIS vêm dos módulos globais importados pelo AppModule.
@Module({
  controllers: [HealthController],
  providers: [
    ServicoDeProntidao,
    {
      provide: VERIFICACOES_DE_PRONTIDAO,
      inject: [BANCO, CLIENTE_REDIS],
      useFactory: verificacoesRegistradas,
    },
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- módulo Nest: o conteúdo vem do decorator
export class HealthModule {}
