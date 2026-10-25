// Prepara o banco do e2e (task 041/043, specs/013 §E2E): recria o leilao_test_<sufixo> do worktree
// pelo mesmo caminho do setup da API (task 032), semeia como dono e aplica a senha de leilao_api
// (task 037). Só o banco do worktree é apagado: prepararBancoDeTeste recusa qualquer outro nome.
//
// Roda como o primeiro passo do `command` do webServer da API (playwright.config.ts), porque o
// Playwright sobe os webServers ANTES do globalSetup: a API não pode conectar antes do DROP/CREATE.
// POSTGRES_DB aqui é o banco de dev (admin); o config o define só neste comando.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { lerConexaoDoBanco, trocarBanco, VARIAVEIS_DA_API } from '../apps/api/src/db/conexao.js';
import { sincronizarSenhaDoPapelDaApi } from '../apps/api/src/db/migrate.js';
import { prepararBancoDeTeste } from '../apps/api/test/setup/banco-de-teste.js';

/** O comando roda em apps/api; o seed usa caminhos relativos à raiz do repositório. */
const RAIZ = fileURLToPath(new URL('..', import.meta.url));

function semear(banco: string): void {
  const resultado = spawnSync(
    process.execPath,
    ['--import', './apps/api/src/db/resolver-ts.mjs', 'apps/api/src/db/seed.ts'],
    { cwd: RAIZ, env: { ...process.env, POSTGRES_DB: banco }, encoding: 'utf8' },
  );
  if (resultado.status !== 0) {
    // O seed já descreve a falha sem valores sensíveis.
    throw new Error(`e2e: db:seed falhou (${resultado.status}): ${resultado.stderr.trim()}`);
  }
}

async function preparar(): Promise<void> {
  const admin = lerConexaoDoBanco(process.env);
  const preparo = await prepararBancoDeTeste(admin);
  semear(preparo.banco);
  const dono = trocarBanco(admin, preparo.banco);
  const api = lerConexaoDoBanco(process.env, VARIAVEIS_DA_API);
  await sincronizarSenhaDoPapelDaApi(dono, api.user, api.password);
}

await preparar();
