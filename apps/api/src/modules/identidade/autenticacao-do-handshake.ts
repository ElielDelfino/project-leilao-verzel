// Autenticação do handshake do Socket.IO (specs/009 §Comportamento, specs/003 §Cookies): o mesmo
// access token JWT do guard HTTP, lido do cabeçalho `Cookie` do handshake. Sem cookie, com cookie
// inválido ou expirado = anônimo: o handshake nunca vira erro por causa da sessão.
import { Inject, Injectable, Logger } from '@nestjs/common';
import { fastifyCookie } from '@fastify/cookie';

import type { UsuarioDaSessao } from '../../common/auth/sessao.js';
import { ENV, type Env } from '../../config/env.js';
import { COOKIE_ACCESS } from './cookies.js';
import { verificarAccessToken } from './tokens.js';

@Injectable()
export class AutenticacaoDoHandshake {
  private readonly logger = new Logger('AutenticacaoDoHandshake');

  constructor(@Inject(ENV) private readonly env: Env) {}

  /**
   * Usuário do cookie `access_token`, ou `undefined` (anônimo). Nunca lança: uma falha inesperada
   * da biblioteca de JWT é registrada só com o nome do erro (sem cookie nem token) e vale como
   * anônimo, que só pode ler.
   */
  async autenticarCookie(cookieHeader: string | undefined): Promise<UsuarioDaSessao | undefined> {
    if (cookieHeader === undefined || cookieHeader === '') {
      return undefined;
    }
    try {
      const token = fastifyCookie.parse(cookieHeader)[COOKIE_ACCESS];
      if (token === undefined || token === '') {
        return undefined;
      }
      return await verificarAccessToken(this.env.segredos.chaveJwt, token);
    } catch (erro: unknown) {
      const nome = erro instanceof Error ? erro.name : 'ErroDesconhecido';
      this.logger.warn(`falha ao verificar o cookie do handshake (${nome}); tratado como anônimo`);
      return undefined;
    }
  }
}
