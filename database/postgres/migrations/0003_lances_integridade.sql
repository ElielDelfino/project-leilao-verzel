-- 0003_lances_integridade (tarefa 073). As tabelas, CHECKs, uniques, o índice e as FKs de key_id
-- (mesmo módulo) foram gerados pelo drizzle-kit a partir de modules/lances/schema.ts (specs/007
-- §Dados, specs/008 §Dados, ADR 0031). O resto foi escrito à mão, depois do último statement
-- gerado: as FKs entre módulos (a fronteira de specs/001 §Módulos impede declará-las nos
-- schema.ts), inclusive as de ledger_entries (D9 da ADR 0031), os triggers append-only e os
-- GRANTs ao papel da API (ADR 0026). Cria tabelas e acrescenta FKs; não altera nem remove coluna.
CREATE TABLE "bids" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"lote_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"licitante_id" uuid NOT NULL,
	"pseudonimo" text NOT NULL,
	"valor_centavos" bigint NOT NULL,
	"criado_em" timestamp (3) with time zone NOT NULL,
	"hash_anterior" "bytea" NOT NULL,
	"hash" "bytea" NOT NULL,
	"assinatura" "bytea" NOT NULL,
	"key_id" text NOT NULL,
	"idempotency_key" uuid NOT NULL,
	CONSTRAINT "bids_lote_id_seq_unique" UNIQUE("lote_id","seq"),
	CONSTRAINT "bids_licitante_id_idempotency_key_unique" UNIQUE("licitante_id","idempotency_key"),
	CONSTRAINT "bids_seq_positivo" CHECK ("bids"."seq" >= 1),
	CONSTRAINT "bids_valor_faixa" CHECK ("bids"."valor_centavos" between 100 and 9007199254740991),
	CONSTRAINT "bids_hash_anterior_tamanho" CHECK (octet_length("bids"."hash_anterior") = 32),
	CONSTRAINT "bids_hash_tamanho" CHECK (octet_length("bids"."hash") = 32),
	CONSTRAINT "bids_assinatura_tamanho" CHECK (octet_length("bids"."assinatura") = 64),
	CONSTRAINT "bids_key_id_formato" CHECK ("bids"."key_id" ~ '^[0-9a-f]{16}$'),
	CONSTRAINT "bids_pseudonimo_formato" CHECK ("bids"."pseudonimo" ~ '^Licitante #[0-9a-f]{6}$')
);
--> statement-breakpoint
CREATE TABLE "lot_seals" (
	"lote_id" uuid PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"total_lances" integer NOT NULL,
	"hash_final" "bytea" NOT NULL,
	"vencedor_pseudonimo" text,
	"valor_arremate_centavos" bigint,
	"selado_em" timestamp (3) with time zone NOT NULL,
	"assinatura" "bytea" NOT NULL,
	"key_id" text NOT NULL,
	CONSTRAINT "lot_seals_status_valido" CHECK ("lot_seals"."status" in ('encerrado', 'cancelado')),
	CONSTRAINT "lot_seals_total_lances_nao_negativo" CHECK ("lot_seals"."total_lances" >= 0),
	CONSTRAINT "lot_seals_hash_final_tamanho" CHECK (octet_length("lot_seals"."hash_final") = 32),
	CONSTRAINT "lot_seals_assinatura_tamanho" CHECK (octet_length("lot_seals"."assinatura") = 64),
	CONSTRAINT "lot_seals_key_id_formato" CHECK ("lot_seals"."key_id" ~ '^[0-9a-f]{16}$'),
	CONSTRAINT "lot_seals_vencedor_pseudonimo_formato" CHECK ("lot_seals"."vencedor_pseudonimo" ~ '^Licitante #[0-9a-f]{6}$'),
	CONSTRAINT "lot_seals_valor_arremate_faixa" CHECK ("lot_seals"."valor_arremate_centavos" is null or "lot_seals"."valor_arremate_centavos" between 100 and 9007199254740991),
	CONSTRAINT "lot_seals_vencedor_com_arremate" CHECK (("lot_seals"."vencedor_pseudonimo" is null) = ("lot_seals"."valor_arremate_centavos" is null)),
	CONSTRAINT "lot_seals_arremate_so_se_vendido" CHECK (("lot_seals"."valor_arremate_centavos" is not null) = ("lot_seals"."status" = 'encerrado' and "lot_seals"."total_lances" > 0))
);
--> statement-breakpoint
CREATE TABLE "signing_keys" (
	"key_id" text PRIMARY KEY NOT NULL,
	"chave_publica" "bytea" NOT NULL,
	"ativa_desde" timestamp (3) with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "signing_keys_chave_publica_tamanho" CHECK (octet_length("signing_keys"."chave_publica") = 32),
	CONSTRAINT "signing_keys_key_id_formato" CHECK ("signing_keys"."key_id" ~ '^[0-9a-f]{16}$'),
	CONSTRAINT "signing_keys_key_id_da_chave" CHECK ("signing_keys"."key_id" = left(encode(sha256("signing_keys"."chave_publica"), 'hex'), 16))
);
--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_key_id_signing_keys_key_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."signing_keys"("key_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot_seals" ADD CONSTRAINT "lot_seals_key_id_signing_keys_key_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."signing_keys"("key_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bids_licitante_id_lote_id_idx" ON "bids" USING btree ("licitante_id","lote_id");--> statement-breakpoint
-- FKs entre módulos, sem CASCADE (lotes, usuários e lances não são excluídos, ADR 0001), todas
-- imediatas: a transação do lance grava bids antes do ledger (D9 da ADR 0031, specs/007).
-- Índices: bids.lote_id e bids.licitante_id são prefixo dos uniques; lot_seals.lote_id é a PK.
-- ledger_entries.lote_id e lance_id ficam sem índice, como lots.lider_id: bids é append-only e a
-- API não tem DELETE em lots, então a FK não varre o ledger, e nenhuma consulta das specs filtra
-- o ledger por elas. bids.key_id e lot_seals.key_id idem (signing_keys é append-only).
-- As linhas que já existem em ledger_entries têm lote_id e lance_id nulos (antes da F3 não há
-- compromisso nem liberação), então a validação das duas FKs não recusa nada.
ALTER TABLE "bids" ADD CONSTRAINT "bids_lote_id_lots_id_fk" FOREIGN KEY ("lote_id") REFERENCES "public"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_licitante_id_users_id_fk" FOREIGN KEY ("licitante_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot_seals" ADD CONSTRAINT "lot_seals_lote_id_lots_id_fk" FOREIGN KEY ("lote_id") REFERENCES "public"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_lote_id_lots_id_fk" FOREIGN KEY ("lote_id") REFERENCES "public"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_lance_id_bids_id_fk" FOREIGN KEY ("lance_id") REFERENCES "public"."bids"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- bids, lot_seals e signing_keys são append-only (specs/008 §Técnica, ADR 0031): os dois
-- triggers em cada uma, obrigatoriamente (o de linha não pega o TRUNCATE). Recusam até o dono.
CREATE TRIGGER "bids_append_only" BEFORE UPDATE OR DELETE ON "public"."bids"
  FOR EACH ROW EXECUTE FUNCTION public.impedir_alteracao();--> statement-breakpoint
CREATE TRIGGER "bids_sem_truncate" BEFORE TRUNCATE ON "public"."bids"
  FOR EACH STATEMENT EXECUTE FUNCTION public.impedir_alteracao();--> statement-breakpoint
CREATE TRIGGER "lot_seals_append_only" BEFORE UPDATE OR DELETE ON "public"."lot_seals"
  FOR EACH ROW EXECUTE FUNCTION public.impedir_alteracao();--> statement-breakpoint
CREATE TRIGGER "lot_seals_sem_truncate" BEFORE TRUNCATE ON "public"."lot_seals"
  FOR EACH STATEMENT EXECUTE FUNCTION public.impedir_alteracao();--> statement-breakpoint
CREATE TRIGGER "signing_keys_append_only" BEFORE UPDATE OR DELETE ON "public"."signing_keys"
  FOR EACH ROW EXECUTE FUNCTION public.impedir_alteracao();--> statement-breakpoint
CREATE TRIGGER "signing_keys_sem_truncate" BEFORE TRUNCATE ON "public"."signing_keys"
  FOR EACH STATEMENT EXECUTE FUNCTION public.impedir_alteracao();--> statement-breakpoint
-- Matriz de privilégios (ADR 0026), tabela a tabela, sem ALTER DEFAULT PRIVILEGES: só SELECT e
-- INSERT nas três (o INSERT ... ON CONFLICT DO NOTHING do boot em signing_keys só exige INSERT).
-- Testada em apps/api/test/db/papeis.test.ts e lances-integridade.test.ts.
GRANT SELECT, INSERT ON TABLE "public"."bids" TO leilao_api;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "public"."lot_seals" TO leilao_api;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "public"."signing_keys" TO leilao_api;