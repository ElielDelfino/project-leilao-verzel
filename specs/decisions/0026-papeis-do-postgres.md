# 0026 — Papéis do Postgres: dono das migrations e papel da API

Status: aceita (só a origem do 6º segredo em produção foi substituída pela 0033: `.env.local` do servidor em vez do Secret Manager)
Data: 2026-10-25
Decisão: do humano, em 2026-10-25 (tarefa 036, itens D1 a D3 aprovados como recomendados)
Complementa: ADR 0005 e ADR 0023 (não as substitui)

## Contexto
O limite registrado em `database/postgres/README.md` (migration 0000) diz que o dono das tabelas append-only, hoje o mesmo usuário que migra e roda a API, pode `DISABLE TRIGGER`, trocar a função `impedir_alteracao()` e usar `session_replication_role = replica`, e que a separação de papéis ficaria para a F1. As tabelas append-only (`ledger_entries` na F1; `bids` e `lot_seals` na F3) nascem agora, então a separação precisa existir antes delas: com um papel só, o trigger (defesa adicional da ADR 0005 à hash chain) protege contra um bug, mas não contra um processo da API comprometido.

Fatos que restringem a solução:
- O Secret Manager gratuito tem 6 versões ativas; a ADR 0023 usa 5, e a rotação já destrói a versão anterior antes de criar a nova.
- O `fetch-secrets.sh` roda antes do `docker.service` e grava um arquivo por segredo (ADR 0023); derivar senha em shell exigiria calcular HMAC sem pôr a senha no argv.
- Papéis do Postgres são do cluster, não do banco: o banco de dev, o template `leilao_test_tpl` e os bancos de teste por worktree (specs/013) compartilham o mesmo papel.

## Decisão
1. **Senha do papel da API: 6º segredo `DB_API_PASSWORD`** no Secret Manager, no mesmo formato de `DB_PASSWORD` (32 bytes em base64url canônico, usada como texto; ADR 0023, item 4). Passa a haver 6 de 6 versões gratuitas em uso. Em produção, o arquivo é `db_api_password`, lido por `DB_API_PASSWORD_FILE` (specs/014 §Segredos).
2. **Dois papéis:**
   - **dono:** `leilao`, o superusuário que a imagem do Postgres cria (`POSTGRES_USER`/`DB_PASSWORD`). Roda `db:migrate` e `db:seed` e é dono de todas as tabelas. A API **não** recebe `DB_PASSWORD` em produção.
   - **API:** `leilao_api`, com `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT`, lido por `POSTGRES_API_USER`/`DB_API_PASSWORD` (e `DB_API_PASSWORD_FILE`). Não é dono de nenhum objeto.
   - A migration cria o papel (só se ainda não existir, porque o papel é do cluster) e os `GRANT`s. O `db:migrate` aplica a senha com `ALTER ROLE ... PASSWORD '<verificador SCRAM-SHA-256>'`, calculado no cliente, para que a senha em texto nunca chegue ao servidor nem ao log (mesmo método do `db:sync-password`, tarefa 023). `POSTGRES_API_USER` tem de ser `leilao_api` (o nome que a migration cria); outro valor faz o `db:migrate` abortar citando só o nome da variável.
3. **Privilégios explícitos por tabela, sem `ALTER DEFAULT PRIVILEGES`:**

   | Tabela | `leilao_api` |
   |---|---|
   | `users` | SELECT, INSERT |
   | `refresh_tokens` | SELECT, INSERT, UPDATE, DELETE |
   | `wallet_balances` | SELECT, INSERT, UPDATE |
   | `ledger_entries` | SELECT, INSERT |
   | `bids`, `lot_seals` (F3) | SELECT, INSERT |

   Nunca `TRUNCATE`, `TRIGGER` nem `REFERENCES`; nenhum acesso ao schema `drizzle` nem `CREATE` no schema `public`. Toda migration que cria tabela concede, ela mesma, os privilégios mínimos que a spec do módulo exige; uma tabela append-only só recebe SELECT e INSERT. A matriz é testada (specs/013 §Papéis do Postgres nos testes; critérios em specs/014 §Papéis do Postgres).

   Os testes de integração da API conectam como dono, com os nomes de variáveis da API; o e2e conecta como `leilao_api`.

## Alternativas consideradas
- **Papel único (situação atual):** nada a migrar, mas deixa a API com `DISABLE TRIGGER` e `session_replication_role`, o limite que motivou esta decisão.
- **`SET ROLE` na conexão da API:** a API continuaria conectando como dono e um `RESET ROLE` desfaz a restrição.
- **Derivar a senha da API de `DB_PASSWORD` por HMAC-SHA256 (5 segredos):** a derivação teria de rodar em shell no `fetch-secrets.sh`, antes do `docker.service`, sem pôr a senha no argv; e a senha da API passaria a depender do segredo do dono.
- **`ALTER DEFAULT PRIVILEGES` para o papel da API:** toda tabela nova, inclusive uma append-only, nasceria com UPDATE e DELETE até alguém lembrar de revogar. Privilégio explícito por tabela falha para o lado seguro.

## Consequências
- Quem tem `DB_PASSWORD` continua superusuário; esse segredo só existe no one-shot de migrations e seed e no Secret Manager, nunca no container da API. O limite do README do Postgres passa a valer só para esse caminho.
- Risco que continua: uma API comprometida ainda consegue `INSERT` linhas falsas em `ledger_entries`, `bids` e `lot_seals` e `UPDATE` em `wallet_balances`; o que ela perde é reescrever ou apagar histórico, desligar triggers e alterar o schema. A detecção continua por hash chain, assinaturas (specs/008) e reconciliação do ledger (specs/004).
- A rotação do `DB_API_PASSWORD` vale a partir do `db:migrate` do deploy; conexões já abertas seguem até a API reiniciar. As 6 versões gratuitas ficam todas em uso: a rotação de qualquer segredo destrói a versão anterior antes de criar a nova, e um sétimo segredo geraria custo.
- A migration que cria o papel precisa ser idempotente em relação ao cluster (banco de dev, template e bancos de teste compartilham o papel); as senhas são do cluster, os `GRANT`s são de cada banco e viajam no template.
- `pnpm demo:adulterar` (specs/008, só dev/demo) desabilita o trigger por SQL e passa a conectar como dono (`POSTGRES_USER`/`DB_PASSWORD`), não como `leilao_api`.
- `keys:generate`, `fetch-secrets.sh`, os composes e o env da API precisam do 6º segredo e das variáveis novas (tarefa 042, infra); schema e `GRANT`s da F1 são do db-dev (tarefa 037); o guard já libera `apps/api/test/db/` para o db-dev.
