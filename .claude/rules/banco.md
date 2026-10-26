---
description: Regras de banco, migrations e Redis (carrega ao editar database, cache, schema.ts ou apps/api/src/db)
paths:
  - "database/**"
  - "cache/**"
  - "apps/api/src/**/schema.ts"
  - "apps/api/src/db/**"
---

# Banco de dados e Redis

- **Dono.** Só o db-dev altera `database/`, `cache/` e os `schema.ts`; migration passa pelo `database-reviewer`. O procedimento está na skill `nova-migracao`.
- **Forward-only.** Migration commitada não muda mais; a correção vai numa migration nova. `database/postgres/migrations/meta/` é do drizzle-kit e nunca se edita à mão.
- **Append-only.** `bids`, `lot_seals`, `signing_keys`, `receipts` e `ledger_entries` têm trigger que recusa UPDATE e DELETE (função `impedir_alteracao`). A tabela nova que guarda histórico recebe os dois triggers (de linha e de TRUNCATE).
- **Papéis.** A API conecta como `leilao_api`, só com os GRANTs listados nas migrations (para as tabelas append-only, apenas SELECT e INSERT). Migrations e seed rodam como o dono. A senha do dono nunca chega à API.
- **Dinheiro.** Colunas `bigint` em centavos, com `CHECK` de faixa.
- **Redis.** Nada de dinheiro nem de lance. As chaves, os donos e os TTLs estão em `cache/redis/README.md`; toda chave nova entra lá.
- **Teste.** O banco modelo dos testes é refeito quando o hash de `migrations/` muda (specs/013).
