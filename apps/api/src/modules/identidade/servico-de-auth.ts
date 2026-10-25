// Regras de cadastro, login, refresh, logout e `me` (specs/003). O controller já passou pelas
// etapas 1 a 4 de §Ordem (CSRF, autenticação, papel, validação); aqui ficam a 5 (rate limit) e a 6
// (regra de negócio).
import { createHash, randomUUID } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';

import type { UsuarioDaSessao } from '../../common/auth/sessao.js';
import { ErroApi } from '../../common/erros/erro-api.js';
import { LimiteDeTentativas } from '../../common/limite/limite-de-tentativas.js';
import { BANCO } from '../../config/banco.module.js';
import { ENV, type Env } from '../../config/env.js';
import { type BancoVerificavel, ErroDoBanco, type Transacao } from '../../db/banco.js';
import type { TokensDaSessao } from './cookies.js';
import { gerarTokenCsrf } from './csrf.js';
import type { DadosDoCadastro, DadosDoLogin } from './esquemas.js';
import {
  buscarCredenciais,
  buscarUsuario,
  type Executor,
  inserirRefresh,
  inserirUsuario,
  marcarSubstituido,
  revogarFamilia,
  revogarFamiliaDoToken,
  travarRefresh,
  type UsuarioPublico,
} from './repositorio.js';
import { ServicoDeSenha } from './servico-de-senha.js';
import { emitirAccessToken, gerarRefreshToken, hashDoRefreshToken } from './tokens.js';

/** Restrição UNIQUE do e-mail (migration 0001). */
const RESTRICAO_DO_EMAIL = 'users_email_unique';
const VIOLACAO_DE_UNICIDADE = '23505';

/** Caracteres hexadecimais do SHA-256 do e-mail na chave do login (specs/003 §Rate limit). */
const HEX_DO_EMAIL_NA_CHAVE = 16;

export interface SessaoIniciada {
  readonly usuario: UsuarioPublico;
  readonly tokens: TokensDaSessao;
}

function erroEmailEmUso(): ErroApi {
  return new ErroApi({
    codigo: 'EMAIL_EM_USO',
    status: HttpStatus.CONFLICT,
    mensagem: 'Este e-mail já está cadastrado.',
  });
}

function erroCredenciais(): ErroApi {
  return new ErroApi({
    codigo: 'CREDENCIAIS_INVALIDAS',
    status: HttpStatus.UNAUTHORIZED,
    mensagem: 'E-mail ou senha inválidos.',
  });
}

function erroSessaoExpirada(): ErroApi {
  return new ErroApi({
    codigo: 'SESSAO_EXPIRADA',
    status: HttpStatus.UNAUTHORIZED,
    mensagem: 'Sessão expirada. Entre novamente.',
  });
}

function erroNaoAutenticado(): ErroApi {
  return new ErroApi({
    codigo: 'NAO_AUTENTICADO',
    status: HttpStatus.UNAUTHORIZED,
    mensagem: 'Autenticação necessária.',
  });
}

function ehEmailRepetido(erro: unknown): boolean {
  return (
    erro instanceof ErroDoBanco &&
    erro.codigo === VIOLACAO_DE_UNICIDADE &&
    erro.restricao === RESTRICAO_DO_EMAIL
  );
}

/** `{ip}:{16 hex do SHA-256 do e-mail em minúsculas}`: o e-mail nunca entra na chave. */
function chaveDoLogin(ip: string, email: string): string {
  const hash = createHash('sha256').update(email.toLowerCase()).digest('hex');
  return `login:${ip}:${hash.slice(0, HEX_DO_EMAIL_NA_CHAVE)}`;
}

type ResultadoDaRotacao =
  | { readonly tipo: 'ok'; readonly usuario: UsuarioDaSessao; readonly refreshToken: string }
  | { readonly tipo: 'recusado' };

@Injectable()
export class ServicoDeAuth {
  constructor(
    @Inject(BANCO) private readonly banco: BancoVerificavel,
    @Inject(ENV) private readonly env: Env,
    @Inject(ServicoDeSenha) private readonly senhas: ServicoDeSenha,
    @Inject(LimiteDeTentativas) private readonly limite: LimiteDeTentativas,
  ) {}

  /** Cria a família nova e os três tokens. */
  private async novaSessao(db: Executor, usuario: UsuarioPublico): Promise<TokensDaSessao> {
    const refresh = gerarRefreshToken();
    await inserirRefresh(db, { userId: usuario.id, familiaId: randomUUID(), hash: refresh.hash });
    return {
      accessToken: await emitirAccessToken(this.env.segredos.chaveJwt, usuario),
      refreshToken: refresh.token,
      csrfToken: gerarTokenCsrf(),
    };
  }

  async cadastrar(dados: DadosDoCadastro, ip: string): Promise<SessaoIniciada> {
    // O 409 também conta: limita a enumeração de e-mails (specs/003 §Rate limit).
    await this.limite.consumir(`cadastro:${ip}`);
    const senhaHash = await this.senhas.gerarHash(dados.senha);
    try {
      return await this.banco.transaction(async (tx) => {
        const usuario = await inserirUsuario(tx, {
          nome: dados.nome,
          email: dados.email,
          senhaHash,
          papel: dados.papel,
        });
        return { usuario, tokens: await this.novaSessao(tx, usuario) };
      });
    } catch (erro: unknown) {
      if (ehEmailRepetido(erro)) {
        throw erroEmailEmUso();
      }
      throw erro;
    }
  }

  /**
   * Login (RNF-02, RNF-03): e-mail inexistente verifica a senha contra o hash dummy, para o tempo
   * e a resposta serem os mesmos da senha errada. Com sucesso, revoga a família do refresh_token
   * recebido (se houver) antes de abrir a nova.
   */
  async entrar(
    dados: DadosDoLogin,
    ip: string,
    refreshRecebido: string | undefined,
  ): Promise<SessaoIniciada> {
    await this.limite.consumir(chaveDoLogin(ip, dados.email));
    const credenciais = await this.banco.consultar((db) => buscarCredenciais(db, dados.email));
    const confere = await this.senhas.verificar(
      dados.senha,
      credenciais?.senhaHash ?? this.senhas.hashDummy,
    );
    if (credenciais === undefined || !confere) {
      throw erroCredenciais();
    }
    const usuario: UsuarioPublico = {
      id: credenciais.id,
      nome: credenciais.nome,
      email: credenciais.email,
      papel: credenciais.papel,
    };
    const hashAntigo =
      refreshRecebido === undefined ? undefined : hashDoRefreshToken(refreshRecebido);
    const tokens = await this.banco.transaction(async (tx) => {
      if (hashAntigo !== undefined) {
        // Só a família do próprio usuário: um cookie de outra conta não revoga a sessão alheia.
        await revogarFamiliaDoToken(tx, hashAntigo, usuario.id);
      }
      return this.novaSessao(tx, usuario);
    });
    return { usuario, tokens };
  }

  /**
   * Rotação na mesma família com a linha travada (FOR UPDATE). Token já substituído ou revogado:
   * revoga a família inteira (gravado antes de responder) e 401 SESSAO_EXPIRADA.
   */
  async renovar(refreshRecebido: string | undefined): Promise<TokensDaSessao> {
    const hash = refreshRecebido === undefined ? undefined : hashDoRefreshToken(refreshRecebido);
    if (hash === undefined) {
      throw erroSessaoExpirada();
    }
    const resultado = await this.banco.transaction((tx) => this.rotacionar(tx, hash));
    if (resultado.tipo !== 'ok') {
      throw erroSessaoExpirada();
    }
    return {
      accessToken: await emitirAccessToken(this.env.segredos.chaveJwt, resultado.usuario),
      refreshToken: resultado.refreshToken,
      csrfToken: gerarTokenCsrf(),
    };
  }

  private async rotacionar(tx: Transacao, hash: Buffer): Promise<ResultadoDaRotacao> {
    const linha = await travarRefresh(tx, hash);
    if (linha === undefined) {
      return { tipo: 'recusado' };
    }
    if (linha.usado) {
      await revogarFamilia(tx, linha.familiaId);
      return { tipo: 'recusado' };
    }
    if (linha.expirado) {
      return { tipo: 'recusado' };
    }
    const usuario = await buscarUsuario(tx, linha.userId);
    if (usuario === undefined) {
      throw new Error('refresh token sem usuário');
    }
    const novo = gerarRefreshToken();
    const novoId = await inserirRefresh(tx, {
      userId: linha.userId,
      familiaId: linha.familiaId,
      hash: novo.hash,
    });
    await marcarSubstituido(tx, linha.id, novoId);
    return {
      tipo: 'ok',
      usuario: { id: usuario.id, papel: usuario.papel },
      refreshToken: novo.token,
    };
  }

  /** Logout: revoga a família do refresh_token recebido, se houver. */
  async sair(refreshRecebido: string | undefined): Promise<void> {
    const hash = refreshRecebido === undefined ? undefined : hashDoRefreshToken(refreshRecebido);
    if (hash !== undefined) {
      await this.banco.transaction((tx) => revogarFamiliaDoToken(tx, hash));
    }
  }

  async me(sessao: UsuarioDaSessao): Promise<UsuarioPublico> {
    const usuario = await this.banco.consultar((db) => buscarUsuario(db, sessao.id));
    if (usuario === undefined) {
      throw erroNaoAutenticado();
    }
    return usuario;
  }
}
