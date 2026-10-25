// Só para os testes de integração da camada de banco (apps/api/test/db/, tarefa 025).
// Regra (code-reviewer H1 da tarefa 003): com LEILAO_TEST_DB definido (verify e CI, specs/013),
// o banco é obrigatório e a falta de variável derruba a coleta com os nomes delas, então nada é
// pulado em silêncio. Sem LEILAO_TEST_DB, e faltando alguma variável, os testes de banco ficam
// como "skipped" no resumo do Vitest e os de unidade continuam rodando.
// LEILAO_TEST_DB é só um sinalizador: aqui conta apenas se está definido e não vazio; o valor
// (`local` ou `testcontainers`, specs/013; o setup global recusa outros) não escolhe banco nem
// muda a conexão, que vem sempre de POSTGRES_* e DB_PASSWORD (ou DB_PASSWORD_FILE).
import { type ConexaoDoBanco, conexaoSeCompleta, lerConexaoDoBanco } from '../../src/db/conexao.js';

export interface AmbienteDeTeste {
  /** Há conexão: os testes de banco rodam. */
  readonly disponivel: boolean;
  /** A conexão; lança se chamado com `disponivel` false (use dentro de describe.skipIf). */
  conexao(): ConexaoDoBanco;
}

export function ambienteDeTeste(
  env: Readonly<Record<string, string | undefined>>,
): AmbienteDeTeste {
  const exigido = env['LEILAO_TEST_DB'] !== undefined && env['LEILAO_TEST_DB'] !== '';
  // Exigido: lerConexaoDoBanco lança ErroDeConfiguracaoDoBanco com os nomes que faltam.
  const conexao = exigido ? lerConexaoDoBanco(env) : conexaoSeCompleta(env);
  return {
    disponivel: conexao !== undefined,
    conexao: () => {
      if (conexao === undefined) {
        throw new Error('teste de banco rodou sem conexão: use describe.skipIf(!disponivel)');
      }
      return conexao;
    },
  };
}
