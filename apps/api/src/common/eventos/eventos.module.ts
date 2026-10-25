// Módulo global do barramento de eventos: um PublicadorDeEventos único por processo, que loga
// a falha de assinante pelo logger do Nest (pino), só com o tipo do evento e o nome do erro.
import { Global, Logger, Module } from '@nestjs/common';

import { PublicadorDeEventos, type TipoDeEvento } from './publicador-de-eventos.js';

export function criarPublicadorDeEventos(logger: Logger): PublicadorDeEventos {
  return new PublicadorDeEventos({
    falhaDeAssinante: (tipo: TipoDeEvento, erro: unknown) => {
      const nome = erro instanceof Error ? erro.name : 'ErroDesconhecido';
      logger.error(`assinante do evento ${tipo} falhou (${nome})`);
    },
  });
}

@Global()
@Module({
  providers: [
    {
      provide: PublicadorDeEventos,
      useFactory: () => criarPublicadorDeEventos(new Logger('Eventos')),
    },
  ],
  exports: [PublicadorDeEventos],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- módulo Nest: o conteúdo vem do decorator
export class EventosModule {}
