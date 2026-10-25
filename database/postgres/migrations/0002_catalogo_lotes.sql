-- 0002_catalogo_lotes (tarefa 051). As tabelas, CHECKs, o unique e os índices foram gerados pelo
-- drizzle-kit a partir de modules/catalogo/schema.ts (specs/005 §Dados) e modules/lotes/schema.ts
-- (specs/006 §Dados). O resto foi escrito à mão, depois do último statement gerado: as FKs entre
-- módulos (a fronteira de specs/001 §Módulos impede declará-las nos schema.ts) e os GRANTs ao
-- papel da API (ADR 0026). Só cria tabelas: não altera nem remove nada que já existia.
CREATE TABLE "card_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"scryfall_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"colecao" text NOT NULL,
	"raridade" text NOT NULL,
	"tipo" text NOT NULL,
	"texto_oracle" text,
	"artista" text,
	"dados" jsonb NOT NULL,
	"imagem" "bytea" NOT NULL,
	"imagem_mime" text NOT NULL,
	"imagem_sha256" "bytea" NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_snapshots_imagem_sha256_tamanho" CHECK (octet_length("card_snapshots"."imagem_sha256") = 32),
	CONSTRAINT "card_snapshots_imagem_mime_valido" CHECK ("card_snapshots"."imagem_mime" in ('image/jpeg', 'image/png'))
);
--> statement-breakpoint
CREATE TABLE "lots" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"leiloeiro_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"carta_nome" text NOT NULL,
	"raridade" text NOT NULL,
	"titulo" text NOT NULL,
	"descricao" text,
	"lance_inicial_centavos" bigint NOT NULL,
	"incremento_minimo_centavos" bigint NOT NULL,
	"inicio_em" timestamp with time zone NOT NULL,
	"fim_em" timestamp with time zone NOT NULL,
	"fim_original_em" timestamp with time zone NOT NULL,
	"status" "status_lote" NOT NULL,
	"lance_atual_centavos" bigint,
	"lider_id" uuid,
	"total_lances" integer DEFAULT 0 NOT NULL,
	"vencedor_id" uuid,
	"valor_arremate_centavos" bigint,
	"encerrado_em" timestamp with time zone,
	"cancelado_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lots_snapshot_id_unique" UNIQUE("snapshot_id"),
	CONSTRAINT "lots_lance_inicial_faixa" CHECK ("lots"."lance_inicial_centavos" between 100 and 100000000),
	CONSTRAINT "lots_incremento_minimo_faixa" CHECK ("lots"."incremento_minimo_centavos" between 100 and 100000000),
	CONSTRAINT "lots_duracao_minima" CHECK ("lots"."fim_original_em" >= "lots"."inicio_em" + interval '5 minutes'),
	CONSTRAINT "lots_duracao_maxima" CHECK ("lots"."fim_original_em" - "lots"."inicio_em" <= interval '7 days'),
	CONSTRAINT "lots_lance_atual_minimo" CHECK ("lots"."lance_atual_centavos" is null or "lots"."lance_atual_centavos" >= "lots"."lance_inicial_centavos"),
	CONSTRAINT "lots_valor_arremate_positivo" CHECK ("lots"."valor_arremate_centavos" is null or "lots"."valor_arremate_centavos" > 0),
	CONSTRAINT "lots_total_lances_nao_negativo" CHECK ("lots"."total_lances" >= 0),
	CONSTRAINT "lots_fim_nao_recua" CHECK ("lots"."fim_em" >= "lots"."fim_original_em")
);
--> statement-breakpoint
CREATE INDEX "lots_status_fim_em_idx" ON "lots" USING btree ("status","fim_em");--> statement-breakpoint
CREATE INDEX "lots_status_inicio_em_idx" ON "lots" USING btree ("status","inicio_em");--> statement-breakpoint
CREATE INDEX "lots_leiloeiro_id_criado_em_id_idx" ON "lots" USING btree ("leiloeiro_id","criado_em" DESC NULLS FIRST,"id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "lots_titulo_trgm_idx" ON "lots" USING gin ("titulo" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "lots_carta_nome_trgm_idx" ON "lots" USING gin ("carta_nome" gin_trgm_ops);--> statement-breakpoint
-- FKs de lots, sem CASCADE (usuários, snapshots e lotes não são excluídos, ADR 0001). Índices:
-- leiloeiro_id é o prefixo de lots_leiloeiro_id_criado_em_id_idx e snapshot_id tem o unique.
-- lider_id e vencedor_id ficam sem índice: users nunca tem DELETE nem UPDATE de id, então a FK
-- não varre lots, e nenhuma consulta de specs/006 filtra por eles.
ALTER TABLE "lots" ADD CONSTRAINT "lots_leiloeiro_id_users_id_fk" FOREIGN KEY ("leiloeiro_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lots" ADD CONSTRAINT "lots_snapshot_id_card_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."card_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lots" ADD CONSTRAINT "lots_lider_id_users_id_fk" FOREIGN KEY ("lider_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lots" ADD CONSTRAINT "lots_vencedor_id_users_id_fk" FOREIGN KEY ("vencedor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Matriz de privilégios (ADR 0026), tabela a tabela, sem ALTER DEFAULT PRIVILEGES. card_snapshots
-- é imutável: só SELECT e INSERT. lots: SELECT e INSERT na tabela e UPDATE só nas colunas que
-- mudam depois da criação (lance, encerramento, cancelamento, anti-sniping; lista em
-- COLUNAS_ATUALIZAVEIS de lotes/schema.ts); sem DELETE (cancelar muda o status). Testada em
-- apps/api/test/db/papeis.test.ts e catalogo-lotes.test.ts.
GRANT SELECT, INSERT ON TABLE "public"."card_snapshots" TO leilao_api;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "public"."lots" TO leilao_api;--> statement-breakpoint
GRANT UPDATE ("fim_em", "status", "lance_atual_centavos", "lider_id", "total_lances", "vencedor_id",
  "valor_arremate_centavos", "encerrado_em", "cancelado_em") ON TABLE "public"."lots" TO leilao_api;