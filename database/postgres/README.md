# Postgres

- `migrations/`: migrations SQL versionadas, forward-only (ADR 0001). Geradas pelo drizzle-kit
  a partir de `apps/api/src/**/schema.ts` e, quando necessário, escritas à mão (triggers, funções).
- Só o papel **db-dev** altera esta pasta (specs/002), com revisão do agente database-reviewer.
- Banco modelo dos testes: `leilao_test_tpl`, refeito quando o hash de `migrations/` muda (specs/013).

## Conexão

Em partes, sem URL (specs/014 §"Conexão da API com Postgres e Redis"): `POSTGRES_HOST`,
`POSTGRES_PORT`, `POSTGRES_DB`, o usuário e a senha, todas obrigatórias e sem default no código.
Faltando alguma (ou com `POSTGRES_PORT` fora de 1–65535), o comando aborta com o nome da
variável, nunca o valor. A leitura fica em `apps/api/src/db/conexao.ts` (`lerConexaoDoBanco`). A
senha fica não enumerável no objeto de conexão (não sai em `JSON.stringify` nem em
`util.inspect`); para trocar só o banco, use `trocarBanco`.

| Quem | Usuário | Senha | Leitura |
|---|---|---|---|
| `db:migrate`, `db:seed`, drizzle-kit, testes de integração da API | `POSTGRES_USER` (dono) | `DB_PASSWORD` xor `DB_PASSWORD_FILE` | `lerConexaoDoBanco(env)` |
| API (tarefa 038) e e2e | `POSTGRES_API_USER` (`leilao_api`) | `DB_API_PASSWORD` xor `DB_API_PASSWORD_FILE` | `lerConexaoDoBanco(env, VARIAVEIS_DA_API)` |

A senha vem de exatamente uma de `<VAR>` (o valor) ou `<VAR>_FILE` (caminho absoluto), na forma
canônica de specs/014 §Leitura (43 caracteres base64url de 32 bytes, sem quebra de linha). As duas
juntas, nenhuma, arquivo ausente ou ilegível e valor fora da forma canônica abortam citando só o
nome da variável. A leitura do arquivo reaproveita `apps/api/src/config/segredos.ts`.

Em dev, os scripts carregam `.env` e `.env.local` da raiz (`node --env-file-if-exists`); uma
variável já exportada no shell tem precedência. Enquanto o `.env` não tiver `POSTGRES_HOST`
(tarefa 007), passe-a no comando: `POSTGRES_HOST=127.0.0.1 pnpm db:migrate`.

## Comandos (na raiz)

| Comando | O que faz |
|---|---|
| `pnpm db:migrate` | Aplica as migrations pendentes (`apps/api/src/db/migrate.ts`) e depois dá `LOGIN` e a senha ao papel da API (§Papéis). Idempotente: o Drizzle registra cada uma em `drizzle.__drizzle_migrations` e aplica só as novas, numa transação; a senha só é reaplicada se mudou. Um advisory lock serializa execuções simultâneas; a segunda espera até 60 s e depois desiste com SQLSTATE `55P03`. Exige as variáveis do dono e as da API. |
| `pnpm db:seed` | Roda numa única transação as etapas de `apps/api/src/modules/<m>/seed.ts` (`apps/api/src/db/seed.ts`), como o dono. Ver §Seed. |
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

- Limite conhecido: o dono das tabelas (`leilao`, superusuário) pode `DISABLE TRIGGER`, trocar a
  função ou usar `session_replication_role = replica`, que desliga os triggers. Desde a migration
  0001 a API não roda como dono, e sim como `leilao_api` (§Papéis), que não consegue nada disso
  (42501, testado). Quem tem a senha do dono (migrations, seed, acesso à VM) continua podendo
  alterar o histórico; isso a hash chain e as assinaturas detectam (specs/008), mas não impedem.

## Migration 0001 (`0001_identidade_carteira.sql`)

- `users` e `refresh_tokens` (identidade, specs/003 §Dados) e `ledger_entries` e
  `wallet_balances` (carteira, specs/004 §Dados). PKs `uuid` com `uuidv7()`; dinheiro em `bigint`
  (centavos).
- `users`: `nome` de 2 a 80 caracteres; `email` `citext` único, até 254.
- `refresh_tokens`: `token_hash` `bytea` único de 32 bytes; índices em `familia_id`, `user_id` e
  `substituido_por` (FK para `refresh_tokens(id)` com `ON DELETE SET NULL`: o expurgo diário
  apaga um token e o anterior da rotação só perde a referência).
- `ledger_entries`: `0 < valor_centavos <= 2^53 − 1`; único `(user_id, idempotency_key)` (chave
  nula não conflita); índice `(user_id, criado_em DESC, id DESC)` do extrato; append-only com os
  dois triggers de `impedir_alteracao()`.
- `wallet_balances`: totais com default 0, `CHECK (comprometido_centavos >= 0 AND
  comprometido_centavos <= total_centavos)` e os dois totais `<= 2^53 − 1`.
- Teto de 2^53 − 1 (9007199254740991) em toda coluna de centavos: a API lê `bigint` em modo
  `number` (ADR 0001), e o CHECK impede valores que o `Number()` arredondaria em silêncio.
- FKs para `users(id)` sem `CASCADE`. As de `ledger_entries` e `wallet_balances` estão só no SQL
  (escritas à mão): `users` é de identidade, e o `schema.ts` de carteira não importa outro módulo
  (specs/001 §Módulos), então o snapshot do drizzle-kit não as conhece.
- **Sem FK por enquanto:** `ledger_entries.lote_id` e `ledger_entries.lance_id`. Entram numa
  migration nova quando `lots` (F2) e `bids` (F3) existirem, com índice.
- Papel `leilao_api`, privilégios e `REVOKE CREATE ON SCHEMA public FROM PUBLIC` (§Papéis).

## Migration 0002 (`0002_catalogo_lotes.sql`)

Só cria tabelas (tarefa 051). PKs `uuid` com `uuidv7()`; dinheiro em `bigint` (centavos, modo
`number` na API), como no ledger.

- `card_snapshots` (catalogo, specs/005 §Dados): imutável (a API só tem SELECT e INSERT).
  `imagem` `bytea` obrigatória; `imagem_sha256` de exatamente 32 bytes; `imagem_mime` só
  `image/jpeg` ou `image/png` (vira o `Content-Type` de `GET /api/imagens/{id}`); `texto_oracle`
  e `artista` podem ser nulos; `scryfall_id` sem unique (cada lote grava o próprio snapshot).
- `lots` (lotes, specs/006 §Dados): `status` com o enum `status_lote`; `carta_nome` e `raridade`
  copiados do snapshot; `total_lances` com default 0. CHECKs da criação:
  `lance_inicial_centavos` e `incremento_minimo_centavos` entre 100 e 100.000.000;
  `fim_original_em >= inicio_em + 5 min` e `fim_original_em − inicio_em <= 7 dias`. CHECKs que
  valem depois dela: `lance_atual_centavos` nulo ou `>= lance_inicial_centavos`;
  `valor_arremate_centavos` nulo ou `> 0`; `total_lances >= 0`; `fim_em >= fim_original_em` (o
  anti-sniping só estende). Sem CHECK de duração máxima em `fim_em` nem de tamanho de título e
  descrição (a API valida). `snapshot_id` único: um snapshot pertence a um lote.
- Índices de `lots`: `(status, fim_em)`, `(status, inicio_em)`,
  `(leiloeiro_id, criado_em DESC, id DESC)` (painel, com o desempate por `id`) e GIN
  `gin_trgm_ops` em `titulo` e em `carta_nome` (busca `ILIKE` da vitrine).
- FKs só no SQL, sem `CASCADE`: `leiloeiro_id`, `lider_id` e `vencedor_id` → `users(id)` e
  `snapshot_id` → `card_snapshots(id)`. Declarar `.references` no `schema.ts` faria `lotes`
  importar `identidade` e `catalogo` (specs/001 §Módulos). `lider_id` e `vencedor_id` ficam sem
  índice: `users` nunca tem DELETE, então a FK não varre `lots`.
- **Ainda sem FK:** `ledger_entries.lote_id → lots(id)` (migration futura, com índice).

## Papéis (D2 e D3 da tarefa 036)

| Papel | Quem usa | Atributos |
|---|---|---|
| `leilao` (dono) | `db:migrate`, `db:seed`, drizzle-kit, testes de integração da API | superusuário criado pela imagem do Postgres; dono de todas as tabelas |
| `leilao_api` | a API e o e2e | `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT` |

- O papel vale para o **cluster inteiro**: o template `leilao_test_tpl` e os bancos dos worktrees
  o compartilham. A migration o cria de forma idempotente (tolera duas migrations simultâneas em
  bancos diferentes), `NOLOGIN`, e retira qualquer atributo de administração que ele tenha.
- Privilégios explícitos, tabela a tabela, sem `ALTER DEFAULT PRIVILEGES`: uma tabela nova nasce
  sem acesso para a API. Nunca `TRUNCATE`, `TRIGGER` nem `REFERENCES`; nenhum acesso ao schema
  `drizzle`; sem `CREATE` em `public`; sem `EXECUTE` em `impedir_alteracao()`.
- No banco: `CONNECT` e `TEMPORARY` saem de `PUBLIC`; `leilao_api` recebe só `CONNECT` (sem
  tabela temporária). O dono é superusuário e continua conectando; o `pg_isready` do healthcheck
  não autentica. A migration usa `current_database()`, sem nome fixo. **Limite:** um
  `CREATE DATABASE ... TEMPLATE` não copia esses privilégios (`datacl`), então os bancos
  `leilao_test_<sufixo>` clonados do modelo voltam ao padrão (`PUBLIC` com `CONNECT` e `TEMP`).
  O teste desses privilégios roda no banco descartável de `migrate.test.ts`, onde a migration
  é aplicada direto.

  | Tabela | `leilao_api` |
  |---|---|
  | `users` | SELECT, INSERT |
  | `refresh_tokens` | SELECT, INSERT, UPDATE, DELETE |
  | `wallet_balances` | SELECT, INSERT, UPDATE |
  | `ledger_entries` | SELECT, INSERT |
  | `card_snapshots` | SELECT, INSERT |
  | `lots` | SELECT, INSERT; UPDATE só em `fim_em`, `status`, `lance_atual_centavos`, `lider_id`, `total_lances`, `vencedor_id`, `valor_arremate_centavos`, `encerrado_em`, `cancelado_em` |
  | `bids`, `lot_seals` (F3) | SELECT, INSERT |

- A matriz é testada (`apps/api/test/db/papeis.test.ts`): toda tabela nova em `public` precisa
  entrar em `MATRIZ` (com `[]` se a API não a acessa) e ganhar os `GRANT`s na própria migration.
  Privilégio de coluna só existe no UPDATE de `lots` (`COLUNAS_ATUALIZAVEIS` em
  `lotes/schema.ts`, conferido por `COLUNAS_COM_UPDATE`): o que é copiado na criação (carta,
  valores iniciais, prazo original, leiloeiro, snapshot) fica imutável para a API.
  Tabela append-only nova entra também em `TABELAS_APPEND_ONLY`.
- **Senha:** depois das migrations, o `db:migrate` lê `POSTGRES_API_USER` e `DB_API_PASSWORD` (ou
  `DB_API_PASSWORD_FILE`) e aplica `ALTER ROLE ... LOGIN PASSWORD '<verificador>'`, com um
  verificador SCRAM-SHA-256 calculado no cliente (`apps/api/src/db/scram.ts`): a senha não vai no
  SQL, no log nem em mensagem de erro. O `ALTER ROLE` roda numa transação com
  `SET LOCAL log_statement = 'none'` e `SET LOCAL log_min_error_statement = 'panic'`, para que nem
  o verificador vá ao log do Postgres. Se o papel já entra com essa senha, nada é alterado. Papel
  inexistente, o próprio dono ou um papel com atributo de administração → erro que cita só
  `POSTGRES_API_USER`. A função é `sincronizarSenhaDoPapelDaApi(conexaoDoDono, papel, senha)`,
  também usada pelo e2e.
- Os testes nunca tocam no `leilao_api` real (é do cluster: trocar a senha dele derrubaria a API
  de dev e os verifies dos outros worktrees). `migrate.test.ts` cria um papel descartável
  `t037_api_<aleatório>` com os mesmos atributos e o apaga no fim.

## Testes

Os testes da camada de banco estão em `apps/api/test/db/` (fora de `src/`, então nada deles vai
para `dist/`) e os de integração precisam do Postgres local (`pnpm infra:up`) e das variáveis de
conexão. Cada execução cria um banco descartável `leilao_t003_<aleatório>`, aplica as migrations
nele e o apaga no fim.

- Com `LEILAO_TEST_DB` definido (o `verify` e o CI, specs/013), as variáveis são obrigatórias: se
  faltar alguma, a coleta falha com os nomes delas. Nada é pulado em silêncio.
- Sem `LEILAO_TEST_DB` e sem as variáveis, os testes de integração aparecem como `skipped` e os de
  unidade rodam.
- `LEILAO_TEST_DB` é só um sinalizador para `ambiente-de-teste.ts`: conta apenas se está definido
  e não vazio. O valor (`local` ou `testcontainers`, specs/013) não escolhe banco nem muda a
  conexão, que vem sempre de `POSTGRES_*` e `DB_PASSWORD` (ou `DB_PASSWORD_FILE`).
- `papeis.test.ts` roda no banco de teste do worktree (já com as migrations), cada caso numa
  transação desfeita no fim. `catalogo-lotes.test.ts` (migration 0002) segue o mesmo modelo.
- `restricoes-snapshot.test.ts` compara o banco migrado com o snapshot da última migration
  (`meta/<idx>_snapshot.json`): as restrições `p`, `u`, `c` e `f` de `public` precisam ser as do
  snapshot mais as FKs escritas à mão (listadas em `FKS_SO_NO_SQL`), e os índices que não
  sustentam restrição, os do snapshot. FK nova escrita à mão entra nessa lista.

## Seed (D14 da tarefa 036)

O `db:seed` descobre as etapas sozinho: para cada módulo, na ordem de specs/001 §Módulos
(`identidade`, `carteira`, `catalogo`, `lotes`, `lances`, `tempo-real`, `liquidacao`), carrega
`apps/api/src/modules/<m>/seed.ts`, se existir, que exporta
`etapasDoSeed: readonly EtapaDoSeed[]`. Nenhuma fase precisa de tarefa do db-dev só para registrar
etapa. Regras desses arquivos:

- etapas idempotentes: rodar o seed de novo não duplica nem falha;
- senha só de `SEED_DEMO_PASSWORD`, recebida no `env` da etapa, nunca fixa no código;
- o `db:seed` roda com type stripping do Node, sem build: nem o `seed.ts` nem o que ele importa
  podem usar decorators, `enum`, `namespace`, parameter properties ou outra sintaxe do TypeScript
  que não seja apagável. Importe as tabelas do `schema.ts` do próprio módulo, não o módulo Nest.

Sem nenhum `seed.ts`, o `db:seed` roda vazio. Um `seed.ts` sem `etapasDoSeed` válido aborta
citando o módulo; uma falha ao importá-lo (módulo ausente, erro de sintaxe) aborta citando o
módulo e o `code` do erro, nunca a mensagem (que pode trazer trechos do arquivo ou caminhos).

Para rodar: `LEILAO_TEST_DB=local POSTGRES_HOST=127.0.0.1 pnpm --filter @leilao/api test`, com as
demais variáveis exportadas no shell (o Vitest não lê o `.env.local`).
