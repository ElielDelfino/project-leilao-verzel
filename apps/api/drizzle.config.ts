// drizzle-kit 0.31 (tarefa 003): gera as migrations SQL em database/postgres/migrations a partir
// dos schema.ts da API. Use pela raiz do repositório (`pnpm db:generate`): os caminhos abaixo são
// relativos ao diretório de onde o drizzle-kit roda. Quem aplica as migrations é `pnpm db:migrate`
// (apps/api/src/db/migrate.ts), não o drizzle-kit.
//
// Conexão em partes, sem URL (specs/014 §"Conexão da API com Postgres e Redis"). O `generate` só
// compara os schema.ts com o snapshot e não precisa de banco: as credenciais entram só quando as
// cinco variáveis estão completas e válidas; os comandos que falam com o banco (studio, pull,
// push) precisam delas. conexao.ts não tem imports, então a cadeia carregada pelo loader do
// drizzle-kit fica neste arquivo e nele.
import { defineConfig } from 'drizzle-kit';

import { conexaoSeCompleta } from './src/db/conexao.js';

const conexao = conexaoSeCompleta(process.env);

export default defineConfig({
  dialect: 'postgresql',
  schema: './apps/api/src/**/schema.ts',
  out: './database/postgres/migrations',
  ...(conexao === undefined
    ? {}
    : {
        dbCredentials: {
          host: conexao.host,
          port: conexao.port,
          database: conexao.database,
          user: conexao.user,
          password: conexao.password,
        },
      }),
});
