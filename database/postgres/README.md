# Postgres

- `migrations/`: migrations SQL versionadas, forward-only (ADR 0001). Geradas pelo drizzle-kit
  a partir de `apps/api/src/**/schema.ts` e, quando necessário, escritas à mão (triggers, funções).
- Só o papel **db-dev** altera esta pasta (specs/002), com revisão do agente database-reviewer.
- Banco modelo dos testes: `leilao_test_tpl`, refeito quando o hash de `migrations/` muda (specs/013).
