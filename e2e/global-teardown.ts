// globalTeardown do e2e (task 043, specs/004 §Critérios de aceite): depois da suíte, a projeção
// wallet_balances tem de ser igual à soma do ledger para todos os usuários. Divergência falha a
// suíte citando só o id do usuário. Conecta como dono no banco do worktree (leilao_test_<sufixo>).
import { createRequire } from 'node:module';

import type { Client as ClientePg } from 'pg';

import { lerConexaoDoBanco, trocarBanco } from '../apps/api/src/db/conexao.js';
import { exigirCarteiraReconciliada } from '../apps/api/test/integracao/reconciliacao.js';
import { nomeDoBancoDoWorktree } from '../apps/api/test/setup/banco-de-teste.js';

// `pg` é dependência da API, não da raiz: resolve a partir do pacote dela.
const daApi = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { Client } = daApi('pg') as { Client: typeof ClientePg };

export default async function globalTeardown(): Promise<void> {
  const conexao = trocarBanco(lerConexaoDoBanco(process.env), nomeDoBancoDoWorktree());
  const cliente = new Client(conexao);
  await cliente.connect();
  try {
    await exigirCarteiraReconciliada(cliente);
  } finally {
    await cliente.end();
  }
}
