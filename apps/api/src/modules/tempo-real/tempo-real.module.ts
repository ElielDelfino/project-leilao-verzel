import { Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';

import { CLIENTE_REDIS } from '../../redis/redis.module.js';
import type { ComandosDePubSub } from '../../redis/cliente.js';
import { AutenticacaoDoHandshake } from '../identidade/index.js';
import { LancesModule } from '../lances/index.js';
import { ADAPTER_REDIS_DO_TEMPO_REAL, criarAdapterRedis } from './adapter-redis.js';
import type { AdapterRedisDoTempoReal } from './adapter-redis.js';
import { DifusaoDeEventos } from './difusao-de-eventos.js';
import { MontadorDoEstado } from './estado-da-sala.js';
import { GatewayDoLeilao } from './gateway-do-leilao.js';
import { LIMITES_DO_TEMPO_REAL, LIMITES_PADRAO } from './limites.js';

/** Fecha os clientes pub/sub do adapter no shutdown, junto com o cliente Redis da API. */
@Injectable()
export class EncerramentoDoAdapter implements OnApplicationShutdown {
  constructor(
    @Inject(ADAPTER_REDIS_DO_TEMPO_REAL) private readonly adapter: AdapterRedisDoTempoReal,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await this.adapter.encerrar();
  }
}

/** Módulo tempo-real (specs/009): gateway Socket.IO `/leilao` e rooms; só consome eventos de domínio. */
@Module({
  imports: [LancesModule],
  providers: [
    AutenticacaoDoHandshake,
    { provide: LIMITES_DO_TEMPO_REAL, useValue: LIMITES_PADRAO },
    {
      provide: ADAPTER_REDIS_DO_TEMPO_REAL,
      inject: [CLIENTE_REDIS],
      useFactory: (redis: ComandosDePubSub): Promise<AdapterRedisDoTempoReal> =>
        criarAdapterRedis(redis),
    },
    EncerramentoDoAdapter,
    MontadorDoEstado,
    DifusaoDeEventos,
    GatewayDoLeilao,
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- módulo Nest: o conteúdo vem do decorator
export class TempoRealModule {}
