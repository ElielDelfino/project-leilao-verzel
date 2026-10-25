-- 0005_receipts_liquidacao (tarefa 102). A tabela, os CHECKs, os uniques e os dois índices foram
-- gerados pelo drizzle-kit a partir de modules/liquidacao/schema.ts (receipts, specs/010 §Dados,
-- D8) e de modules/carteira/schema.ts (índice único parcial do ledger, D4). O resto foi escrito à
-- mão, depois do último statement gerado: as FKs entre módulos, os triggers append-only e o GRANT
-- ao papel da API (ADR 0026). Cria tabela e índice; não altera nem remove coluna.
-- O índice do ledger não é CONCURRENTLY (a migration roda em transação): ledger_entries é pequeno
-- e, antes da F4, não há estorno nem lançamento de liquidação com lote_id, então nada é recusado.
CREATE TABLE "receipts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"lote_id" uuid NOT NULL,
	"codigo_publico" text NOT NULL,
	"vencedor_id" uuid NOT NULL,
	"vencedor_pseudonimo" text NOT NULL,
	"valor_centavos" bigint NOT NULL,
	"hash_final" "bytea" NOT NULL,
	"assinatura_selo" "bytea" NOT NULL,
	"key_id" text NOT NULL,
	"selado_em" timestamp (3) with time zone NOT NULL,
	"emitido_em" timestamp (3) with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "receipts_lote_id_unique" UNIQUE("lote_id"),
	CONSTRAINT "receipts_codigo_publico_unique" UNIQUE("codigo_publico"),
	CONSTRAINT "receipts_codigo_publico_formato" CHECK ("receipts"."codigo_publico" ~ '^[0-9A-Za-z]{16}$'),
	CONSTRAINT "receipts_vencedor_pseudonimo_formato" CHECK ("receipts"."vencedor_pseudonimo" ~ '^Licitante #[0-9a-f]{6}$'),
	CONSTRAINT "receipts_valor_faixa" CHECK ("receipts"."valor_centavos" between 100 and 9007199254740991),
	CONSTRAINT "receipts_hash_final_tamanho" CHECK (octet_length("receipts"."hash_final") = 32),
	CONSTRAINT "receipts_assinatura_selo_tamanho" CHECK (octet_length("receipts"."assinatura_selo") = 64),
	CONSTRAINT "receipts_key_id_formato" CHECK ("receipts"."key_id" ~ '^[0-9a-f]{16}$')
);
--> statement-breakpoint
CREATE INDEX "receipts_vencedor_id_emitido_em_id_idx" ON "receipts" USING btree ("vencedor_id","emitido_em" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entries_lote_id_tipo_unico" ON "ledger_entries" USING btree ("lote_id","tipo") WHERE "ledger_entries"."tipo" IN ('estorno', 'debito_arremate', 'credito_arremate') AND "ledger_entries"."lote_id" IS NOT NULL;--> statement-breakpoint
-- FKs entre módulos, só no SQL e sem CASCADE (lotes, usuários e chaves nunca são apagados pela
-- API). Índices: receipts.lote_id é o unique; vencedor_id é prefixo do índice do extrato;
-- key_id fica sem índice, como bids.key_id e lot_seals.key_id (signing_keys é append-only).
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_lote_id_lots_id_fk" FOREIGN KEY ("lote_id") REFERENCES "public"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_vencedor_id_users_id_fk" FOREIGN KEY ("vencedor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_key_id_signing_keys_key_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."signing_keys"("key_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- receipts é append-only (specs/008 §Técnica): os dois triggers, obrigatoriamente (o de linha
-- não pega o TRUNCATE). Recusam até o dono.
CREATE TRIGGER "receipts_append_only" BEFORE UPDATE OR DELETE ON "public"."receipts"
  FOR EACH ROW EXECUTE FUNCTION public.impedir_alteracao();--> statement-breakpoint
CREATE TRIGGER "receipts_sem_truncate" BEFORE TRUNCATE ON "public"."receipts"
  FOR EACH STATEMENT EXECUTE FUNCTION public.impedir_alteracao();--> statement-breakpoint
-- Matriz de privilégios (ADR 0026): só SELECT e INSERT. Testada em papeis.test.ts e
-- receipts-liquidacao.test.ts.
GRANT SELECT, INSERT ON TABLE "public"."receipts" TO leilao_api;
