import { Module } from '@nestjs/common';

import { BANCO, BancoModule } from '../config/banco.module.js';
import type { Banco } from '../db/banco.js';
import type { ClienteRedis } from '../redis/cliente.js';
import { CLIENTE_REDIS, RedisModule } from '../redis/redis.module.js';
import { HealthController } from './health.controller.js';
import {
  ServicoDeProntidao,
  VERIFICACOES_DE_PRONTIDAO,
  type VerificacaoDeProntidao,
} from './prontidao.js';
import { verificacaoDoPostgres, verificacaoDoRedis } from './verificacoes.js';

function verificacoesRegistradas(
  banco: Banco,
  redis: ClienteRedis,
): readonly VerificacaoDeProntidao[] {
  return [verificacaoDoPostgres(banco), verificacaoDoRedis(redis)];
}

// BancoModule e RedisModule são globais: importá-los aqui os registra para toda a API. Quando uma
// tarefa listar app.module.ts, os imports passam para o AppModule.
@Module({
  imports: [BancoModule, RedisModule],
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
