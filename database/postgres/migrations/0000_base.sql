-- 0000_base (tarefa 003). Os enums foram gerados pelo drizzle-kit a partir de
-- apps/api/src/db/schema.ts; as extensões e a função foram acrescentadas à mão, porque o
-- drizzle-kit não as gera.
--
-- citext: e-mail único sem diferenciar maiúsculas (specs/003 §Dados, users.email).
-- pg_trgm: índice trigram no título dos lotes (specs/006 §Dados).
-- As duas são "trusted" no Postgres 13+: o dono do banco as cria sem ser superusuário.
CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;--> statement-breakpoint
CREATE TYPE "public"."papel_usuario" AS ENUM('leiloeiro', 'licitante');--> statement-breakpoint
CREATE TYPE "public"."status_lote" AS ENUM('agendado', 'ao_vivo', 'encerrado', 'cancelado');--> statement-breakpoint
CREATE TYPE "public"."tipo_lancamento" AS ENUM('deposito', 'compromisso', 'liberacao', 'estorno', 'debito_arremate', 'credito_arremate');--> statement-breakpoint
-- impedir_alteracao(): função genérica dos triggers append-only (bids, lot_seals: specs/008
-- §Técnica; ledger_entries: specs/004 §Dados). Cada uma dessas tabelas a liga com os dois:
--   BEFORE UPDATE OR DELETE ... FOR EACH ROW EXECUTE FUNCTION public.impedir_alteracao()
--   BEFORE TRUNCATE ... FOR EACH STATEMENT EXECUTE FUNCTION public.impedir_alteracao()
-- Erro: SQLSTATE 23001 (restrict_violation) com a tabela em TABLE/SCHEMA. A mensagem cita só a
-- tabela e a operação, nunca valores da linha (OLD/NEW).
-- search_path vazio: a função não resolve nenhum nome pelo caminho de busca de quem a dispara.
-- Sem EXECUTE para PUBLIC: ninguém a chama fora de trigger (disparar trigger não exige EXECUTE).
CREATE FUNCTION public.impedir_alteracao() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'a tabela % é append-only: % não é permitido', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation',
          TABLE = TG_TABLE_NAME,
          SCHEMA = TG_TABLE_SCHEMA;
END;
$$;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.impedir_alteracao() FROM PUBLIC;--> statement-breakpoint
COMMENT ON FUNCTION public.impedir_alteracao() IS 'Trigger append-only: recusa UPDATE, DELETE e TRUNCATE com SQLSTATE 23001 (tarefa 003).';
