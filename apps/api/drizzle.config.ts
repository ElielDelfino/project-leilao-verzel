// drizzle-kit 0.31 (tarefa 003): gera as migrations SQL em database/postgres/migrations a partir
// dos schema.ts da API. Use pela raiz do repositório (`pnpm db:generate`): os caminhos abaixo são
// relativos ao diretório de onde o drizzle-kit roda. Quem aplica as migrations é `pnpm db:migrate`
// (apps/api/src/db/migrate.ts), não o drizzle-kit.
//
// Conexão em partes, sem URL (specs/014 §"Conexão da API com Postgres e Redis"): as cinco
// variáveis são obrigatórias, e a falta de qualquer uma aborta com o nome dela, nunca o valor.
import { defineConfig } from 'drizzle-kit';

import { lerConexaoDoBanco } from './src/db/conexao.js';

const { host, port, database, user, password } = lerConexaoDoBanco(process.env);

export default defineConfig({
  dialect: 'postgresql',
  schema: './apps/api/src/**/schema.ts',
  out: './database/postgres/migrations',
  dbCredentials: { host, port, database, user, password },
});
