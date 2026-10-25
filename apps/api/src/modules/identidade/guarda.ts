// Guard global (APP_GUARD) das etapas 1 a 3 de specs/003 §Ordem das verificações: CSRF (403
// CSRF_INVALIDO) → autenticação (401 NAO_AUTENTICADO) → papel (403 PAPEL_NAO_PERMITIDO). A
// validação (4) é dos pipes e o rate limit (5), dos serviços. Rota sem anotação exige sessão;
// @SessaoOpcional() lê a sessão se o access token for válido e, senão, segue anônima (sem 401).
import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';

import {
  CHAVE_PAPEL,
  CHAVE_PUBLICO,
  CHAVE_SESSAO_OPCIONAL,
  type RequisicaoComSessao,
} from '../../common/auth/metadados.js';
import type { PapelDoUsuario, UsuarioDaSessao } from '../../common/auth/sessao.js';
import { ErroApi } from '../../common/erros/erro-api.js';
import { ENV, type Env } from '../../config/env.js';
import { COOKIE_ACCESS, COOKIE_CSRF } from './cookies.js';
import { csrfConfere, METODOS_COM_CSRF } from './csrf.js';
import { verificarAccessToken } from './tokens.js';

const CABECALHO_CSRF = 'x-csrf-token';

/** Erro de programação: combinação proibida de decorators de autorização numa rota. */
export class ErroDeConfiguracaoDeAuth extends Error {
  override readonly name = 'ErroDeConfiguracaoDeAuth';
}

@Injectable()
export class GuardaDeAutenticacao implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    // Só HTTP por enquanto; o handshake do Socket.IO (specs/009) terá a própria verificação.
    if (contexto.getType() !== 'http') {
      return true;
    }
    const requisicao = contexto.switchToHttp().getRequest<FastifyRequest & RequisicaoComSessao>();
    const alvos = [contexto.getHandler(), contexto.getClass()];
    const sessaoOpcional = this.combinacaoValida(alvos);

    if (
      METODOS_COM_CSRF.has(requisicao.method) &&
      !csrfConfere(requisicao.cookies[COOKIE_CSRF], requisicao.headers[CABECALHO_CSRF])
    ) {
      throw new ErroApi({
        codigo: 'CSRF_INVALIDO',
        status: HttpStatus.FORBIDDEN,
        mensagem: 'Token CSRF ausente ou inválido.',
      });
    }

    if (this.reflector.getAllAndOverride<boolean | undefined>(CHAVE_PUBLICO, alvos) === true) {
      return true;
    }

    const usuario = await this.usuarioDoCookie(requisicao);
    if (sessaoOpcional) {
      if (usuario !== undefined) {
        requisicao.usuario = usuario;
      }
      return true;
    }
    if (usuario === undefined) {
      throw new ErroApi({
        codigo: 'NAO_AUTENTICADO',
        status: HttpStatus.UNAUTHORIZED,
        mensagem: 'Autenticação necessária.',
      });
    }
    requisicao.usuario = usuario;

    const papel = this.reflector.getAllAndOverride<PapelDoUsuario | undefined>(CHAVE_PAPEL, alvos);
    if (papel !== undefined && usuario.papel !== papel) {
      throw new ErroApi({
        codigo: 'PAPEL_NAO_PERMITIDO',
        status: HttpStatus.FORBIDDEN,
        mensagem: 'Sua conta não tem permissão para esta ação.',
      });
    }
    return true;
  }

  /**
   * Falha fechada: @SessaoOpcional (no handler ou na classe) junto de @Papel ou @Publico (no
   * handler ou na classe) é erro de configuração. O Error genérico vira 500 INDISPONIVEL sem
   * detalhes na resposta. Devolve se a rota tem @SessaoOpcional.
   */
  private combinacaoValida(alvos: Parameters<Reflector['getAllAndOverride']>[1]): boolean {
    const tem = (chave: string): boolean =>
      this.reflector.getAllAndOverride<unknown>(chave, alvos) !== undefined;
    const sessaoOpcional = tem(CHAVE_SESSAO_OPCIONAL);
    if (sessaoOpcional && (tem(CHAVE_PAPEL) || tem(CHAVE_PUBLICO))) {
      throw new ErroDeConfiguracaoDeAuth(
        '@SessaoOpcional não pode ser combinado com @Papel nem com @Publico',
      );
    }
    return sessaoOpcional;
  }

  private async usuarioDoCookie(requisicao: FastifyRequest): Promise<UsuarioDaSessao | undefined> {
    const token = requisicao.cookies[COOKIE_ACCESS];
    return token === undefined || token === ''
      ? undefined
      : verificarAccessToken(this.env.segredos.chaveJwt, token);
  }
}
