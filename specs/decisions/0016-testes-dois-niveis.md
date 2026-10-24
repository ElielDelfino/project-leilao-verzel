# 0016 — Testes em pirâmide e verificação em dois níveis

Status: aceita
Data: 2026-10-24

## Decisão
Unidade, integração (Postgres real), contrato (OpenAPI/AsyncAPI), e2e (Playwright + axe-core) e carga (k6). Cobertura ≥ 80% no domínio. `verify:quick` (só o que mudou, banco local via TEMPLATE) e `verify:full` (tudo + Testcontainers + build; `--e2e`). Detalhes em specs/013.

## Alternativas consideradas
Só o nível full (lento a cada iteração); sem e2e (perde a prova dos fluxos ao vivo).

## Consequências
Exige `scripts/verify.mjs` e o setup de banco modelo já na fase F0.
