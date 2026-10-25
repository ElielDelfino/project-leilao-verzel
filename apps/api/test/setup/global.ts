// Setup global do Vitest para os testes da API (tarefas 011 e 032, specs/013 §"Banco de teste"),
// ligado por test/setup/vitest.config.ts. Roda uma vez, antes de criar os workers:
// - LEILAO_TEST_DB ausente ou vazio: nada a fazer; os testes de banco ficam "skipped"
//   (test/db/ambiente-de-teste.ts).
// - LEILAO_TEST_DB=local: Postgres local já no ar (pnpm infra:up). Refaz o leilao_test_tpl se o hash
//   das migrations mudou, recria o leilao_test_<sufixo> do worktree a partir dele e troca só
//   POSTGRES_DB para os workers (specs/014 §Conexão: não há DATABASE_URL). O teardown devolve o
//   POSTGRES_DB original (a conexão de administração é lida uma vez só, aqui).
// - LEILAO_TEST_DB=testcontainers: modo da tarefa 030, ainda não implementado aqui.
// Outro valor não vazio falha com mensagem clara.
import { lerConexaoDoBanco } from '../../src/db/conexao.js';
import { prepararBancoDeTeste } from './banco-de-teste.js';

export type BancoDeTeste = 'local' | 'testcontainers';

/** Lê LEILAO_TEST_DB; valor desconhecido lança, para nada rodar sem banco em silêncio. */
export function bancoDeTesteDoAmbiente(
  env: Readonly<Record<string, string | undefined>>,
): BancoDeTeste | undefined {
  const valor = env['LEILAO_TEST_DB'];
  if (valor === undefined || valor === '') {
    return undefined;
  }
  if (valor === 'local' || valor === 'testcontainers') {
    return valor;
  }
  throw new Error('LEILAO_TEST_DB inválido: use "local" ou "testcontainers"');
}

let postgresDbOriginal: string | undefined;

export async function setup(): Promise<void> {
  const modo = bancoDeTesteDoAmbiente(process.env);
  if (modo === undefined) {
    return;
  }
  if (modo === 'testcontainers') {
    throw new Error('LEILAO_TEST_DB=testcontainers ainda não é suportado pelo setup (task 030)');
  }
  // Falta de variável lança ErroDeConfiguracaoDoBanco só com os nomes, nunca os valores.
  const admin = lerConexaoDoBanco(process.env);
  const preparo = await prepararBancoDeTeste(admin);
  postgresDbOriginal = process.env['POSTGRES_DB'];
  // Os workers do Vitest nascem depois deste setup e herdam o process.env.
  process.env['POSTGRES_DB'] = preparo.banco;
  const modelo = preparo.modeloRefeito ? 'refeito' : 'reaproveitado';
  process.stdout.write(
    `banco de teste: ${preparo.banco} recriado em ${Math.round(preparo.msParaRecriar)} ms ` +
      `(modelo ${modelo}, migrations ${preparo.hash.slice(0, 12)})\n`,
  );
}

export function teardown(): void {
  if (postgresDbOriginal !== undefined) {
    process.env['POSTGRES_DB'] = postgresDbOriginal;
    postgresDbOriginal = undefined;
  }
}
