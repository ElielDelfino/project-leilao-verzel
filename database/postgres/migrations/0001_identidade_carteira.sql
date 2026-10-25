-- 0001_identidade_carteira (tarefa 037). As tabelas, CHECKs, uniques, índices e as FKs de
-- refresh_tokens foram gerados pelo drizzle-kit a partir de modules/identidade/schema.ts
-- (specs/003 §Dados) e modules/carteira/schema.ts (specs/004 §Dados). O resto foi escrito à mão,
-- depois do último statement gerado: FKs de carteira para users, triggers append-only, papel da
-- API, privilégios no banco e GRANTs (decisões D2 e D3 da tarefa 036). Revisão da tarefa 037
-- (antes do merge, por isso nesta mesma migration): CHECKs de valor ≤ 2^53 − 1, FK
-- substituido_por com ON DELETE SET NULL e CONNECT/TEMP do banco fora de PUBLIC.
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"tipo" "tipo_lancamento" NOT NULL,
	"valor_centavos" bigint NOT NULL,
	"lote_id" uuid,
	"lance_id" uuid,
	"idempotency_key" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_user_id_idempotency_key_unique" UNIQUE("user_id","idempotency_key"),
	CONSTRAINT "ledger_entries_valor_positivo" CHECK ("ledger_entries"."valor_centavos" > 0),
	CONSTRAINT "ledger_entries_valor_seguro" CHECK ("ledger_entries"."valor_centavos" <= 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE "wallet_balances" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"total_centavos" bigint DEFAULT 0 NOT NULL,
	"comprometido_centavos" bigint DEFAULT 0 NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_balances_comprometido_valido" CHECK ("wallet_balances"."comprometido_centavos" >= 0 AND "wallet_balances"."comprometido_centavos" <= "wallet_balances"."total_centavos"),
	CONSTRAINT "wallet_balances_total_seguro" CHECK ("wallet_balances"."total_centavos" <= 9007199254740991),
	CONSTRAINT "wallet_balances_comprometido_seguro" CHECK ("wallet_balances"."comprometido_centavos" <= 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"familia_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"expira_em" timestamp with time zone NOT NULL,
	"revogado_em" timestamp with time zone,
	"substituido_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_tokens_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "refresh_tokens_token_hash_tamanho" CHECK (octet_length("refresh_tokens"."token_hash") = 32)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"nome" text NOT NULL,
	"email" "citext" NOT NULL,
	"senha_hash" text NOT NULL,
	"papel" "papel_usuario" NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_nome_tamanho" CHECK (char_length("users"."nome") between 2 and 80),
	CONSTRAINT "users_email_tamanho" CHECK (char_length("users"."email") <= 254)
);
--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_substituido_por_refresh_tokens_id_fk" FOREIGN KEY ("substituido_por") REFERENCES "public"."refresh_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_entries_user_id_criado_em_id_idx" ON "ledger_entries" USING btree ("user_id","criado_em" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "refresh_tokens_familia_id_idx" ON "refresh_tokens" USING btree ("familia_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_substituido_por_idx" ON "refresh_tokens" USING btree ("substituido_por");--> statement-breakpoint
-- FKs de carteira → users(id), sem CASCADE (usuários não são excluídos, ADR 0001). Ficam fora do
-- schema.ts de carteira porque users é de identidade e carteira não importa outro módulo
-- (specs/001 §Módulos). user_id já é o prefixo dos índices de ledger_entries e a PK de
-- wallet_balances, então as duas FKs têm índice.
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_balances" ADD CONSTRAINT "wallet_balances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- ledger_entries é append-only (specs/004 §Dados, specs/008): os dois triggers, obrigatoriamente
-- (o de linha não pega o TRUNCATE).
CREATE TRIGGER "ledger_entries_append_only" BEFORE UPDATE OR DELETE ON "public"."ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION public.impedir_alteracao();--> statement-breakpoint
CREATE TRIGGER "ledger_entries_sem_truncate" BEFORE TRUNCATE ON "public"."ledger_entries"
  FOR EACH STATEMENT EXECUTE FUNCTION public.impedir_alteracao();--> statement-breakpoint
-- Papel da API (D2): leilao_api, sem nenhum atributo de administração. O papel vale para o cluster
-- inteiro (o template leilao_test_tpl e os bancos dos worktrees o compartilham), então a criação é
-- idempotente e tolera duas migrations simultâneas em bancos diferentes. Nasce NOLOGIN: quem lhe dá
-- LOGIN e senha é o `pnpm db:migrate` (apps/api/src/db/migrate.ts), com um verificador SCRAM. Se o
-- papel já existia com algum atributo de administração, eles são retirados; LOGIN e senha não são
-- tocados. O ALTER só roda quando há o que corrigir: dois ALTER ROLE simultâneos no mesmo papel
-- podem falhar com "tuple concurrently updated".
DO $$
BEGIN
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'leilao_api') THEN
      CREATE ROLE leilao_api NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
    END IF;
  EXCEPTION
    -- Outra migration criou o papel entre o IF e o CREATE.
    WHEN duplicate_object OR unique_violation THEN NULL;
  END;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
     WHERE rolname = 'leilao_api'
       AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolinherit)
  ) THEN
    ALTER ROLE leilao_api NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
  END IF;
END
$$;--> statement-breakpoint
-- Privilégios no banco: CONNECT e TEMPORARY vêm de PUBLIC por padrão. Só leilao_api ganha CONNECT
-- (sem TEMP); o dono é superusuário e continua conectando. Feito para o banco corrente, sem nome
-- fixo (leilao em dev e prod, leilao_test_tpl e os descartáveis dos testes). Atenção: um
-- CREATE DATABASE ... TEMPLATE não copia esses privilégios (datacl): o clone volta ao padrão.
DO $$
BEGIN
  EXECUTE format('REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format('REVOKE CONNECT ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO leilao_api', current_database());
END
$$;--> statement-breakpoint
-- Ninguém além do dono cria objetos em public (padrão desde o Postgres 15; explícito aqui).
REVOKE CREATE ON SCHEMA public FROM PUBLIC;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO leilao_api;--> statement-breakpoint
-- Matriz D3, tabela a tabela, sem ALTER DEFAULT PRIVILEGES (uma tabela nova nasce sem acesso) e
-- nunca TRUNCATE, TRIGGER nem REFERENCES. Nenhum acesso ao schema drizzle. Testada em
-- apps/api/test/db/papeis.test.ts: toda tabela nova de public precisa entrar lá.
GRANT SELECT, INSERT ON TABLE "public"."users" TO leilao_api;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."refresh_tokens" TO leilao_api;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE "public"."wallet_balances" TO leilao_api;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "public"."ledger_entries" TO leilao_api;
