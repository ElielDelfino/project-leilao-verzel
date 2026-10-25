// Setup global do Vitest para os testes da API (tarefa 011, specs/013), ligado por
// test/setup/vitest.config.ts. Roda uma vez, antes de criar os workers:
// - LEILAO_TEST_DB ausente ou vazio: nada a fazer; os testes de banco ficam "skipped"
//   (test/db/ambiente-de-teste.ts).
// - LEILAO_TEST_DB=local: Postgres local já no ar (pnpm infra:up). Refaz o leilao_test_tpl se o hash
//   das migrations mudou, recria o leilao_test a partir dele e troca só POSTGRES_DB para os workers
//   (specs/014 §Conexão: não há DATABASE_URL).
// O banco isolado do verify:full (Testcontainers, specs/013) depende de um pedido ao infra; veja o
// relatório da tarefa 011.
import { lerConexaoDoBanco } from '../../src/db/conexao.js';
import { BANCO_DE_TESTE, prepararBancoDeTeste } from './banco-de-teste.js';

export type BancoDeTeste = 'local';

/** Lê LEILAO_TEST_DB; valor desconhecido lança, para nada rodar sem banco em silêncio. */
export function bancoDeTesteDoAmbiente(
  env: Readonly<Record<string, string | undefined>>,
): BancoDeTeste | undefined {
  const valor = env['LEILAO_TEST_DB'];
  if (valor === undefined || valor === '') {
    return undefined;
  }
  if (valor === 'local') {
    return valor;
  }
  throw new Error(
    `LEILAO_TEST_DB=${JSON.stringify(valor)} não é suportado; use "local" ou deixe vazio`,
  );
}

export async function setup(): Promise<void> {
  if (bancoDeTesteDoAmbiente(process.env) === undefined) {
    return;
  }
  // Falta de variável lança ErroDeConfiguracaoDoBanco só com os nomes, nunca os valores.
  const admin = lerConexaoDoBanco(process.env);
  const preparo = await prepararBancoDeTeste(admin);
  // Os workers do Vitest nascem depois deste setup e herdam o process.env.
  process.env['POSTGRES_DB'] = BANCO_DE_TESTE;
  const modelo = preparo.modeloRefeito ? 'refeito' : 'reaproveitado';
  process.stdout.write(
    `banco de teste: ${BANCO_DE_TESTE} recriado em ${Math.round(preparo.msParaRecriar)} ms ` +
      `(modelo ${modelo}, migrations ${preparo.hash.slice(0, 12)})\n`,
  );
}
