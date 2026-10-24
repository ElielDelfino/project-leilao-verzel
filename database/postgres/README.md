# Postgres

- `migrations/`: migrations SQL versionadas, forward-only (ADR 0001). Geradas pelo drizzle-kit
  a partir de `apps/api/src/**/schema.ts` e, quando necessário, escritas à mão (triggers, funções).
- Só o papel **db-dev** altera esta pasta (specs/002), com revisão do agente database-reviewer.
- Banco modelo dos testes: `leilao_test_tpl`, refeito quando o hash de `migrations/` muda (specs/013).

## Conexão

Em partes, sem URL (specs/014 §"Conexão da API com Postgres e Redis"): `POSTGRES_HOST`,
`POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER` e `DB_PASSWORD`, todas obrigatórias e sem
default no código. Faltando alguma (ou com `POSTGRES_PORT` fora de 1–65535), o comando aborta
com o nome da variável, nunca o valor. A leitura fica em `apps/api/src/db/conexao.ts` e vale para
o pool da API, `db:migrate`, `db:seed` e `db:generate`.

Em dev, os scripts carregam `.env` e `.env.local` da raiz (`node --env-file-if-exists`); uma
variável já exportada no shell tem precedência. Enquanto o `.env` não tiver `POSTGRES_HOST`
(tarefa 007), passe-a no comando: `POSTGRES_HOST=127.0.0.1 pnpm db:migrate`.

## Comandos (na raiz)

| Comando | O que faz |
|---|---|
| `pnpm db:migrate` | Aplica as migrations pendentes (`apps/api/src/db/migrate.ts`). Idempotente: o Drizzle registra cada uma em `drizzle.__drizzle_migrations` e aplica só as novas, numa transação; um advisory lock serializa execuções simultâneas. |
| `pnpm db:seed` | Roda as etapas de seed numa única transação (`apps/api/src/db/seed.ts`). Hoje não há etapas; as contas demo (specs/003 RF-03, senha de `SEED_DEMO_PASSWORD`) chegam na F1. |
| `pnpm db:generate --name <nome>` | Gera a próxima migration a partir dos `schema.ts` (drizzle-kit, `apps/api/drizzle.config.ts`). |

`db:migrate` e `db:seed` rodam o TypeScript direto no Node 24 (type stripping), com o hook
`apps/api/src/db/resolver-ts.mjs`, que resolve os imports `./x.js` do fonte para `./x.ts`.

## Escrevendo uma migration

1. Altere o `schema.ts` do módulo dono da tabela (specs/001 §Módulos) e rode `pnpm db:generate --name <nome>`.
2. Revise o SQL gerado linha a linha. O que o drizzle-kit não gera (triggers, funções, extensões,
   `CHECK` complexos) entra à mão no mesmo arquivo, **antes do commit**, separado por
   `--> statement-breakpoint`.
3. Depois do commit a migration não muda mais: correções vão numa migration nova.
4. Não edite `migrations/meta/`: é o snapshot e o diário do drizzle-kit.

## Migration 0000 (`0000_base.sql`)

- Extensões `citext` (e-mail de `users`, specs/003) e `pg_trgm` (busca no título dos lotes, specs/006).
- Enums, declarados em `apps/api/src/db/schema.ts`: `papel_usuario` (specs/003), `status_lote`
  (specs/006), `tipo_lancamento` (specs/004).
- `public.impedir_alteracao()`: função genérica dos triggers append-only (`bids`, `lot_seals`,
  `ledger_entries`; specs/004, specs/008). Recusa a operação com SQLSTATE `23001`
  (`restrict_violation`), com a tabela nos campos `table`/`schema` do erro e uma mensagem que cita
  só a tabela e a operação, nunca valores da linha. Uso:

  ```sql
  CREATE TRIGGER bids_append_only BEFORE UPDATE OR DELETE ON bids
    FOR EACH ROW EXECUTE FUNCTION public.impedir_alteracao();
  -- opcional, para barrar também o TRUNCATE:
  CREATE TRIGGER bids_sem_truncate BEFORE TRUNCATE ON bids
    FOR EACH STATEMENT EXECUTE FUNCTION public.impedir_alteracao();
  ```

## Testes

Os testes de integração da camada de banco estão em `apps/api/src/db/*.test.ts` e precisam do
Postgres local (`pnpm infra:up`) e das variáveis de conexão. Cada execução cria um banco
descartável `leilao_t003_<aleatório>`, aplica as migrations nele e o apaga no fim. Para rodar:
`POSTGRES_HOST=127.0.0.1 pnpm --filter @leilao/api exec vitest run src/db` com as demais variáveis
no ambiente. O `pnpm --filter @leilao/api test` (`--dir test`) ainda não os coleta.
