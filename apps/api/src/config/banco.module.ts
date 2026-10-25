// Pool do Postgres (db/banco.ts, tarefa 003) como provider global do Nest (tarefa 017): criado no
// boot a partir do env validado e encerrado no shutdown, depois que o servidor HTTP para de aceitar
// requisições. O lugar natural deste arquivo é src/db/, que é do db-dev (scripts/agents/guard_paths.py);
// fica em config/ por enquanto, junto do env de que depende.
import {
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';

import { type BancoVerificavel, criarBanco } from '../db/banco.js';
import { descreverFalhaSemDetalhes } from '../logger/falha-sem-detalhes.js';
import { ENV, type Env } from './env.js';

/** Token de injeção do BancoVerificavel (consultar, transaction, verificar). */
export const BANCO = Symbol('BANCO');

@Injectable()
class EncerramentoDoBanco implements OnApplicationShutdown {
  constructor(@Inject(BANCO) private readonly banco: BancoVerificavel) {}

  async onApplicationShutdown(): Promise<void> {
    await this.banco.encerrar();
  }
}

function criarBancoDoEnv(env: Env): BancoVerificavel {
  const logger = new Logger('Banco');
  return criarBanco({
    conexao: env.postgres,
    // O erro chega como ErroDoBanco, só com o código (ECONNRESET, 57P01...).
    aoErroOcioso: (erro) =>
      logger.warn(`conexão com o Postgres falhou: ${descreverFalhaSemDetalhes(erro)}`),
  });
}

@Global()
@Module({
  providers: [{ provide: BANCO, inject: [ENV], useFactory: criarBancoDoEnv }, EncerramentoDoBanco],
  exports: [BANCO],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- módulo Nest: o conteúdo vem do decorator
export class BancoModule {}
