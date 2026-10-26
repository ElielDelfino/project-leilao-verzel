---
name: nova-migracao
description: Cria ou altera uma migration do Postgres (Drizzle) neste projeto. Use ao mudar um schema.ts, criar tabela, coluna, índice, trigger ou GRANT.
---

# Nova migration

Só o db-dev executa; o `database-reviewer` revisa. Detalhes de conexão, papéis e comandos: `database/postgres/README.md`.

1. **Gerar.** Altere o `schema.ts` do módulo dono da tabela e rode `pnpm db:generate --name <nome>`. Pronto quando surgir `database/postgres/migrations/000N_<nome>.sql` com o snapshot novo em `meta/`.
2. **Completar à mão, antes do commit.** O drizzle-kit não gera trigger, função, extensão, `CHECK` complexo, FK entre módulos nem GRANT. Acrescente-os no mesmo arquivo, separados por `--> statement-breakpoint`. Pronto quando toda tabela de histórico tiver os dois triggers append-only (linha e TRUNCATE) e `GRANT SELECT, INSERT` ao `leilao_api`, e toda tabela comum tiver os GRANTs que a API precisa.
3. **Conferir a ordem.** Depois de rebase, `when` no `_journal.json` cresce junto com `idx`. Se não crescer, a migration é ignorada em silêncio nos bancos que já aplicaram a outra: apague a sua (ainda não commitada na `main`) e gere de novo.
4. **Aplicar.** `pnpm db:migrate` no banco local e `pnpm verify:quick`, que refaz o banco modelo dos testes. Pronto quando ambos passam.
5. **Escalar.** Migration que remove ou altera coluna existente vai ao humano antes do merge (specs/002 §Escalonamento).

Depois do commit a migration não muda: a correção vai numa migration nova. Nunca edite `meta/` à mão.
