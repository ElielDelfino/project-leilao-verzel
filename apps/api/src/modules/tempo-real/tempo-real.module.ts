import { Module } from '@nestjs/common';

/** Módulo tempo-real (specs/009): rooms Socket.IO; só consome eventos de domínio. */
@Module({})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- módulo Nest: o conteúdo vem do decorator
export class TempoRealModule {}
