// globalSetup do e2e (task 041, specs/013 §E2E): prepara o leilao_test_<sufixo> do worktree pelo
// mesmo caminho do setup da API (task 032), semeia como dono e aplica a senha de leilao_api
// (task 037). Só o banco do worktree é apagado: prepararBancoDeTeste recusa qualquer outro nome.
import { spawnSync } from 'node:child_process';

import { lerConexaoDoBanco, trocarBanco, VARIAVEIS_DA_API } from '../apps/api/src/db/conexao.js';
import { sincronizarSenhaDoPapelDaApi } from '../apps/api/src/db/migrate.js';
import { prepararBancoDeTeste } from '../apps/api/test/setup/banco-de-teste.js';

function semear(banco: string): void {
  const resultado = spawnSync(
    process.execPath,
    ['--import', './apps/api/src/db/resolver-ts.mjs', 'apps/api/src/db/seed.ts'],
    { env: { ...process.env, POSTGRES_DB: banco }, encoding: 'utf8' },
  );
  if (resultado.status !== 0) {
    // O seed já descreve a falha sem valores sensíveis.
    throw new Error(`e2e: db:seed falhou (${resultado.status}): ${resultado.stderr.trim()}`);
  }
}

export default async function globalSetup(): Promise<void> {
  const admin = lerConexaoDoBanco(process.env);
  const preparo = await prepararBancoDeTeste(admin);
  semear(preparo.banco);
  const dono = trocarBanco(admin, preparo.banco);
  const api = lerConexaoDoBanco(process.env, VARIAVEIS_DA_API);
  await sincronizarSenhaDoPapelDaApi(dono, api.user, api.password);
}
