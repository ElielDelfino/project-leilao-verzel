// Expurgo diário dos refresh tokens expirados há mais de 1 dia (specs/003 §Comportamento e
// §Dados). setInterval de 24 h com unref (não segura o processo), parado no shutdown.
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';

import { BANCO } from '../../config/banco.module.js';
import type { Banco } from '../../db/banco.js';
import { descreverFalhaSemDetalhes } from '../../logger/falha-sem-detalhes.js';
import { apagarExpiradosAntesDe } from './repositorio.js';

const UM_DIA_MS = 86_400_000;
export const INTERVALO_DO_EXPURGO_MS = UM_DIA_MS;

/** Apaga os tokens com `expira_em` anterior a `agora` − 1 dia. Devolve quantos apagou. */
export function expurgarRefreshTokens(banco: Banco, agora: Date): Promise<number> {
  const limite = new Date(agora.getTime() - UM_DIA_MS);
  return banco.consultar((db) => apagarExpiradosAntesDe(db, limite));
}

@Injectable()
export class ExpurgoDiario implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ExpurgoDiario.name);
  #temporizador: NodeJS.Timeout | undefined;

  constructor(@Inject(BANCO) private readonly banco: Banco) {}

  onApplicationBootstrap(): void {
    this.#temporizador = setInterval(() => {
      void this.executar(new Date());
    }, INTERVALO_DO_EXPURGO_MS);
    this.#temporizador.unref();
  }

  onApplicationShutdown(): void {
    clearInterval(this.#temporizador);
    this.#temporizador = undefined;
  }

  /** Uma rodada; a falha vai para o log (warn, sem detalhes) e a próxima rodada tenta de novo. */
  async executar(agora: Date): Promise<void> {
    try {
      const apagados = await expurgarRefreshTokens(this.banco, agora);
      this.logger.log(`expurgo de refresh tokens: ${apagados} apagados`);
    } catch (erro: unknown) {
      this.logger.warn(`expurgo de refresh tokens falhou: ${descreverFalhaSemDetalhes(erro)}`);
    }
  }
}
