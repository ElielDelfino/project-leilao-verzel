import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { AuthController } from './auth.controller.js';
import { ExpurgoDiario } from './expurgo.js';
import { GuardaDeAutenticacao } from './guarda.js';
import { ServicoDeAuth } from './servico-de-auth.js';
import { ServicoDeSenha } from './servico-de-senha.js';

/**
 * Módulo identidade (specs/003): dono de `users` e `refresh_tokens`. Registra o guard global
 * (APP_GUARD; specs/001 §Módulos) que aplica CSRF, autenticação e papel em toda rota da API.
 * Depende dos providers globais BANCO, ENV e LimiteDeTentativas (AppModule).
 */
@Module({
  controllers: [AuthController],
  providers: [
    ServicoDeSenha,
    ServicoDeAuth,
    ExpurgoDiario,
    { provide: APP_GUARD, useClass: GuardaDeAutenticacao },
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- módulo Nest: o conteúdo vem do decorator
export class IdentidadeModule {}
