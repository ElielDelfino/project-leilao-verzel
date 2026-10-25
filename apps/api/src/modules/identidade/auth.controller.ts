// Rotas da tag auth do openapi.yaml (specs/003 §Interfaces e contratos).
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { Publico, UsuarioAtual } from '../../common/auth/metadados.js';
import type { UsuarioDaSessao } from '../../common/auth/sessao.js';
import { type RespostaDeSucesso, sucesso } from '../../common/envelope.js';
import { PipeZod } from '../../common/validacao/pipe-zod.js';
import { ENV, type Env } from '../../config/env.js';
import {
  COOKIE_REFRESH,
  emitirCookieCsrf,
  emitirCookiesDeSessao,
  expirarCookies,
} from './cookies.js';
import { gerarTokenCsrf } from './csrf.js';
import {
  type DadosDoCadastro,
  type DadosDoLogin,
  esquemaDoCadastro,
  esquemaDoLogin,
} from './esquemas.js';
import type { UsuarioPublico } from './repositorio.js';
import { ServicoDeAuth } from './servico-de-auth.js';

interface UsuarioLogado {
  readonly usuario: UsuarioPublico;
}

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(ServicoDeAuth) private readonly auth: ServicoDeAuth,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Publico()
  @Get('csrf')
  @HttpCode(HttpStatus.NO_CONTENT)
  csrf(@Res({ passthrough: true }) resposta: FastifyReply): void {
    emitirCookieCsrf(resposta, gerarTokenCsrf(), this.env.cookiesSeguros);
  }

  @Publico()
  @Post('cadastro')
  @HttpCode(HttpStatus.CREATED)
  async cadastro(
    @Body(new PipeZod(esquemaDoCadastro)) dados: DadosDoCadastro,
    @Req() requisicao: FastifyRequest,
    @Res({ passthrough: true }) resposta: FastifyReply,
  ): Promise<RespostaDeSucesso<UsuarioLogado>> {
    const { usuario, tokens } = await this.auth.cadastrar(dados, requisicao.ip);
    emitirCookiesDeSessao(resposta, tokens, this.env.cookiesSeguros);
    return sucesso({ usuario });
  }

  @Publico()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new PipeZod(esquemaDoLogin)) dados: DadosDoLogin,
    @Req() requisicao: FastifyRequest,
    @Res({ passthrough: true }) resposta: FastifyReply,
  ): Promise<RespostaDeSucesso<UsuarioLogado>> {
    const { usuario, tokens } = await this.auth.entrar(
      dados,
      requisicao.ip,
      requisicao.cookies[COOKIE_REFRESH],
    );
    emitirCookiesDeSessao(resposta, tokens, this.env.cookiesSeguros);
    return sucesso({ usuario });
  }

  @Publico()
  @Post('refresh')
  @HttpCode(HttpStatus.NO_CONTENT)
  async refresh(
    @Req() requisicao: FastifyRequest,
    @Res({ passthrough: true }) resposta: FastifyReply,
  ): Promise<void> {
    const tokens = await this.auth.renovar(requisicao.cookies[COOKIE_REFRESH]);
    emitirCookiesDeSessao(resposta, tokens, this.env.cookiesSeguros);
  }

  @Publico()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() requisicao: FastifyRequest,
    @Res({ passthrough: true }) resposta: FastifyReply,
  ): Promise<void> {
    await this.auth.sair(requisicao.cookies[COOKIE_REFRESH]);
    expirarCookies(resposta, this.env.cookiesSeguros);
  }

  @Get('me')
  async me(@UsuarioAtual() sessao: UsuarioDaSessao): Promise<RespostaDeSucesso<UsuarioPublico>> {
    return sucesso(await this.auth.me(sessao));
  }
}
