// Senhas para o Nest: hash, verificação e o hash dummy do RNF-03 (specs/003), calculado no boot
// com os mesmos parâmetros do RNF-01, para o login com e-mail inexistente custar o mesmo tempo.
import { randomBytes } from 'node:crypto';

import { Injectable, type OnModuleInit } from '@nestjs/common';

import { gerarHashDeSenha, verificarSenha } from './senha.js';

const BYTES_DA_SENHA_DUMMY = 32;

@Injectable()
export class ServicoDeSenha implements OnModuleInit {
  #hashDummy: string | undefined;

  async onModuleInit(): Promise<void> {
    // Senha aleatória descartada: ninguém consegue casar com o hash dummy.
    this.#hashDummy = await gerarHashDeSenha(
      randomBytes(BYTES_DA_SENHA_DUMMY).toString('base64url'),
    );
  }

  /** PHC argon2id do RNF-03. Lança se lido antes do boot (erro de programação). */
  get hashDummy(): string {
    if (this.#hashDummy === undefined) {
      throw new Error('hash dummy ainda não calculado (onModuleInit)');
    }
    return this.#hashDummy;
  }

  gerarHash(senha: string): Promise<string> {
    return gerarHashDeSenha(senha);
  }

  verificar(senha: string, phc: string): Promise<boolean> {
    return verificarSenha(senha, phc);
  }
}
