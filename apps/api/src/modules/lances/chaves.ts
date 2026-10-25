// Chave de assinatura ativa e chave dos pseudônimos (specs/008 §Chaves, ADR 0031 D1). A chave
// privada só existe em memória, como KeyObject: a seed não é guardada, e nada aqui a registra,
// devolve em erro ou grava no banco. O registro em signing_keys acontece no boot (falha fechada).
import { Inject, Injectable } from '@nestjs/common';
import type { KeyObject } from 'node:crypto';

import { BANCO } from '../../config/banco.module.js';
import { ENV, type Env } from '../../config/env.js';
import type { Banco } from '../../db/banco.js';
import { assinar, derivarChaves } from './integridade/assinatura.js';
import { pseudonimo } from './integridade/pseudonimo.js';
import { registrarChavePublica } from './repositorio.js';

/** Assinatura pronta para gravar: base64url e o `keyId` da chave que assinou. */
export interface Assinado {
  readonly assinatura: string;
  readonly keyId: string;
}

/**
 * Chaves do módulo lances. `registrar` (no boot) grava a chave pública em `signing_keys`; antes
 * disso `assinar` recusa, para nenhum lance ou selo sair com uma chave que ninguém verifica.
 */
@Injectable()
export class ServicoDeChaves {
  readonly #chavePrivada: KeyObject;
  readonly #chavePseudonimo: Uint8Array;
  readonly #banco: Banco;
  /** Os 32 bytes da chave pública ativa. */
  readonly chavePublica: Uint8Array;
  /** 16 hex de SHA-256(chave pública). */
  readonly keyId: string;
  #registrada = false;

  constructor(@Inject(ENV) env: Env, @Inject(BANCO) banco: Banco) {
    const chaves = derivarChaves(env.segredos.sementeEd25519);
    this.#chavePrivada = chaves.chavePrivada;
    this.#chavePseudonimo = env.segredos.chavePseudonimo;
    this.#banco = banco;
    this.chavePublica = chaves.chavePublica;
    this.keyId = chaves.keyId;
  }

  /**
   * `INSERT ... ON CONFLICT DO NOTHING` da chave ativa. Lança se o banco falhar ou se o `keyId`
   * já estiver publicado com outra chave (colisão do prefixo): quem chama não deixa a API subir.
   */
  async registrar(): Promise<void> {
    const gravada = await this.#banco.consultar((db) =>
      registrarChavePublica(db, this.keyId, this.chavePublica),
    );
    if (gravada === null || !gravada.equals(this.chavePublica)) {
      throw new Error(`signing_keys não publica a chave ativa (keyId ${this.keyId})`);
    }
    this.#registrada = true;
  }

  /** Assina os 32 bytes de `hashHex` com a chave ativa; recusa antes de `registrar`. */
  assinar(hashHex: string): Assinado {
    if (!this.#registrada) {
      throw new Error('chave de assinatura ainda não registrada em signing_keys');
    }
    return { assinatura: assinar(this.#chavePrivada, hashHex), keyId: this.keyId };
  }

  /** Pseudônimo do licitante no lote (specs/008 §Técnica). */
  pseudonimo(loteId: string, licitanteId: string): string {
    return pseudonimo(this.#chavePseudonimo, loteId, licitanteId);
  }
}
