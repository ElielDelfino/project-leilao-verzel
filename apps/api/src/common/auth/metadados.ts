// Decorators de autorização (specs/003 §Comportamento; ADR 0025: só metadados e tipos aqui). Quem
// aplica as regras é o guard global do módulo identidade (APP_GUARD), na ordem de specs/003
// §Ordem das verificações. Rota sem anotação exige sessão.
import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';

import type { PapelDoUsuario, UsuarioDaSessao } from './sessao.js';

export const CHAVE_PUBLICO = 'leilao:auth:publico';
export const CHAVE_PAPEL = 'leilao:auth:papel';

/** Rota sem autenticação (pula as etapas 2 e 3; o CSRF continua valendo para POST etc.). */
export const Publico = (): MethodDecorator & ClassDecorator => SetMetadata(CHAVE_PUBLICO, true);

/** Rota restrita a um papel: outro papel recebe 403 PAPEL_NAO_PERMITIDO. */
export const Papel = (papel: PapelDoUsuario): MethodDecorator & ClassDecorator =>
  SetMetadata(CHAVE_PAPEL, papel);

/** Requisição depois do guard: `usuario` existe nas rotas que exigem sessão. */
export interface RequisicaoComSessao {
  usuario?: UsuarioDaSessao;
}

/** Erro de programação: @UsuarioAtual numa rota sem sessão (por exemplo, @Publico). */
export class ErroDeUsoDoUsuarioAtual extends Error {
  override readonly name = 'ErroDeUsoDoUsuarioAtual';
}

export function usuarioDaRequisicao(contexto: ExecutionContext): UsuarioDaSessao {
  const usuario = contexto.switchToHttp().getRequest<RequisicaoComSessao>().usuario;
  if (usuario === undefined) {
    throw new ErroDeUsoDoUsuarioAtual('@UsuarioAtual usado numa rota sem sessão');
  }
  return usuario;
}

/** Parâmetro com o usuário da sessão (id e papel), posto pelo guard global. */
export const UsuarioAtual = createParamDecorator((_dados: unknown, contexto: ExecutionContext) =>
  usuarioDaRequisicao(contexto),
);
