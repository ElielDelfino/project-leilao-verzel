// Redis real para os testes de integração (tarefa 017). Mesma regra de test/db/ambiente-de-teste.ts:
// com LEILAO_TEST_DB definido (verify e CI, specs/013), o Redis é obrigatório e a falta de
// variável derruba a coleta com os nomes; sem LEILAO_TEST_DB, faltando alguma variável, os testes
// de Redis ficam "skipped".
import { type ConexaoDoRedis, criarConexaoDoRedis } from '../../src/redis/conexao.js';

const VARIAVEIS = ['REDIS_HOST', 'REDIS_PORT', 'REDIS_PASSWORD'] as const;

export interface AmbienteDoRedis {
  readonly disponivel: boolean;
  /** A conexão; lança se chamado com `disponivel` false (use dentro de describe.skipIf). */
  conexao(): ConexaoDoRedis;
}

export function ambienteDoRedis(
  env: Readonly<Record<string, string | undefined>>,
): AmbienteDoRedis {
  const exigido = env['LEILAO_TEST_DB'] !== undefined && env['LEILAO_TEST_DB'] !== '';
  const faltando = VARIAVEIS.filter((nome) => !env[nome]);
  if (exigido && faltando.length > 0) {
    throw new Error(`Redis de teste: variáveis ausentes: ${faltando.join(', ')}`);
  }
  const conexao =
    faltando.length === 0
      ? criarConexaoDoRedis(
          { host: env['REDIS_HOST'] ?? '', port: Number(env['REDIS_PORT']) },
          env['REDIS_PASSWORD'] ?? '',
        )
      : undefined;
  return {
    disponivel: conexao !== undefined,
    conexao: () => {
      if (conexao === undefined) {
        throw new Error('teste de Redis rodou sem conexão: use describe.skipIf(!disponivel)');
      }
      return conexao;
    },
  };
}
