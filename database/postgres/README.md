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
o pool da API, `db:migrate` e `db:seed`. A senha fica não enumerável no objeto de conexão (não sai
em `JSON.stringify` nem em `util.inspect`); para trocar só o banco, use `trocarBanco`.

Em dev, os scripts carregam `.env` e `.env.local` da raiz (`node --env-file-if-exists`); uma
variável já exportada no shell tem precedência. Enquanto o `.env` não tiver `POSTGRES_HOST`
(tarefa 007), passe-a no comando: `POSTGRES_HOST=127.0.0.1 pnpm db:migrate`.

## Comandos (na raiz)

| Comando | O que faz |
|---|---|
| `pnpm db:migrate` | Aplica as migrations pendentes (`apps/api/src/db/migrate.ts`). Idempotente: o Drizzle registra cada uma em `drizzle.__drizzle_migrations` e aplica só as novas, numa transação. Um advisory lock serializa execuções simultâneas; a segunda espera até 60 s e depois desiste com SQLSTATE `55P03`. |
| `pnpm db:seed` | Roda as etapas de seed numa única transação (`apps/api/src/db/seed.ts`). Hoje não há etapas; as contas demo (specs/003 RF-03, senha de `SEED_DEMO_PASSWORD`) chegam na F1. |
| `pnpm db:generate --name <nome>` | Gera a próxima migration a partir dos `schema.ts` (drizzle-kit, `apps/api/drizzle.config.ts`). Não precisa de banco nem das variáveis de conexão. |

`db:migrate` e `db:seed` rodam o TypeScript direto no Node 24.2 ou mais novo (type stripping e
`import.meta.main`), com o hook `apps/api/src/db/resolver-ts.mjs`, que resolve os imports `./x.js`
do fonte para `./x.ts`.

**Imagem de produção:** o runner acha as migrations em `database/postgres/migrations`, quatro
níveis acima de `src/db/` (ou de `dist/db/`). A imagem que roda `db:migrate` (tarefa 007) precisa
copiar essa pasta mantendo a mesma posição relativa.

## Escrevendo uma migration

1. Altere o `schema.ts` do módulo dono da tabela (specs/001 §Módulos) e rode `pnpm db:generate --name <nome>`.
2. Revise o SQL gerado linha a linha. O que o drizzle-kit não gera (triggers, funções, extensões,
   `CHECK` complexos) entra à mão no mesmo arquivo, **antes do commit**, separado por
   `--> statement-breakpoint`.
3. Depois do commit a migration não muda mais: correções vão numa migration nova.
4. Não edite `migrations/meta/` à mão: é o snapshot e o diário do drizzle-kit.
5. **Ordem do `_journal.json` depois de rebase.** O migrator do Drizzle aplica uma migration só se
   o `when` dela (milissegundos da geração) for maior que o `created_at` da última aplicada no
   banco. Se duas branches geram migrations em paralelo e a mais antiga entra por último, a
   migration dela é **ignorada em silêncio** nos bancos que já aplicaram a outra. Depois de um
   rebase com migration nova, confira que `when` cresce junto com `idx` no `_journal.json`; se
   não crescer, apague a migration da sua branch (ainda não commitada na `main`) e gere de novo.

## Migration 0000 (`0000_base.sql`)

- Extensões `citext` (e-mail de `users`, specs/003) e `pg_trgm` (busca no título dos lotes, specs/006).
- Enums, declarados em `apps/api/src/db/schema.ts`: `papel_usuario` (specs/003), `status_lote`
  (specs/006), `tipo_lancamento` (specs/004).
- `public.impedir_alteracao()`: função genérica dos triggers append-only (`bids`, `lot_seals`,
  `ledger_entries`; specs/004, specs/008). Recusa a operação com SQLSTATE `23001`
  (`restrict_violation`), com a tabela nos campos `table`/`schema` do erro e uma mensagem que cita
  só a tabela e a operação, nunca valores da linha. Roda com `search_path` vazio e sem `EXECUTE`
  para `PUBLIC` (disparar o trigger não exige `EXECUTE`; testado com um papel sem privilégio).
  **Cada tabela append-only liga os dois triggers, obrigatoriamente** (o de linha não pega o
  `TRUNCATE`):

  ```sql
  CREATE TRIGGER bids_append_only BEFORE UPDATE OR DELETE ON bids
    FOR EACH ROW EXECUTE FUNCTION public.impedir_alteracao();
  CREATE TRIGGER bids_sem_truncate BEFORE TRUNCATE ON bids
    FOR EACH STATEMENT EXECUTE FUNCTION public.impedir_alteracao();
  ```

- Limite conhecido: o dono da tabela (hoje, o mesmo usuário que migra e roda a API) pode
  `DISABLE TRIGGER` ou trocar a função, e `session_replication_role = replica` desliga os
  triggers. A separação de papéis (dono × API) fica para a F1, por decisão do humano; a detecção
  pela hash chain e pelas assinaturas continua valendo (specs/008).

## Testes

Os testes da camada de banco estão em `apps/api/src/db/*.test.ts` (vão para `apps/api/test/db/`
na tarefa 025) e os de integração precisam do Postgres local (`pnpm infra:up`) e das variáveis de
conexão. Cada execução cria um banco descartável `leilao_t003_<aleatório>`, aplica as migrations
nele e o apaga no fim.

- Com `LEILAO_TEST_DB` definido (o `verify` e o CI, specs/013), as variáveis são obrigatórias: se
  faltar alguma, a coleta falha com os nomes delas. Nada é pulado em silêncio.
- Sem `LEILAO_TEST_DB` e sem as variáveis, os testes de integração aparecem como `skipped` e os de
  unidade rodam.

Para rodar: `LEILAO_TEST_DB=local POSTGRES_HOST=127.0.0.1 pnpm --filter @leilao/api exec vitest run src/db`,
com as demais variáveis exportadas no shell (o Vitest não lê o `.env.local`). O
`pnpm --filter @leilao/api test` (`--dir test`) ainda não os coleta.
