import { Module } from '@nestjs/common';

import { HealthController } from './health.controller.js';
import {
  ServicoDeProntidao,
  VERIFICACOES_DE_PRONTIDAO,
  type VerificacaoDeProntidao,
} from './prontidao.js';

// As verificações reais de Postgres e Redis entram quando os clientes existirem (pool do
// apps/api/src/db/ da tarefa 003 e o cliente Redis). Até lá a lista é vazia e o /ready responde
// 503: a API não se declara pronta sem ter verificado as dependências.
const VERIFICACOES_REGISTRADAS: readonly VerificacaoDeProntidao[] = [];

@Module({
  controllers: [HealthController],
  providers: [
    ServicoDeProntidao,
    { provide: VERIFICACOES_DE_PRONTIDAO, useValue: VERIFICACOES_REGISTRADAS },
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- módulo Nest: o conteúdo vem do decorator
export class HealthModule {}
