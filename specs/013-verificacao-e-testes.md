# 013 — Verificação e testes

Status: aprovada
Depende de: 001, 002

## Níveis de teste
| Nível | Ferramenta | Escopo |
|---|---|---|
| Unidade | Vitest | regras de lance, anti-sniping, ledger, canonicalização, hash chain, verificação, pseudônimo, mapeamento de erros no front |
| Integração | Vitest + Postgres real + Redis | rotas da API, concorrência de lances, job de encerramento, triggers, reconciliação do ledger |
| Contrato | Vitest + validador OpenAPI/AsyncAPI | toda resposta de teste de integração é validada contra o `openapi.yaml`; payloads de eventos contra o `asyncapi.yaml` |
| E2E | Playwright | cadastro/login; depósito; lance → superado → ganhando; liquidação → comprovante; auditoria detectando adulteração; cancelamento com estorno; axe-core |
| Carga | k6 | 50 VUs dando lances num lote + 200 sockets; thresholds p95 < 300 ms e entrega < 1 s |

Cobertura mínima de 80% (linhas e branches) nos módulos de domínio da API (`lances`, `carteira`, `lotes`, `liquidacao`, `identidade`).

## Dois níveis de verificação (ADR 0016)
### `pnpm verify:quick` (padrão)
- Considera só o que mudou desde `git merge-base HEAD main`: commits, alterações e arquivos novos.
- Lint só nos arquivos alterados; typecheck dos pacotes afetados e dos que dependem deles.
- Testes ligados ao que mudou: o teste alterado ou o de mesmo nome do arquivo-fonte (`src/x.ts` → `test/x.test.ts`), e os testes de banco alterados.
- Não roda build, e2e nem a suíte inteira.
- Aceita testes explícitos: `pnpm verify:quick -- test/lances.test.ts -t "anti-sniping"`.
- Banco local já no ar (`LEILAO_TEST_DB=local`): as migrations são aplicadas em `leilao_test_tpl`, refeito só quando o hash da pasta `database/postgres/migrations` muda (hash guardado no `COMMENT ON DATABASE`). Cada execução recria `leilao_test` com `CREATE DATABASE leilao_test TEMPLATE leilao_test_tpl`.
- Se o Postgres local estiver fora, tenta `pnpm infra:up` ou mostra o comando.
- Roda todos os passos e sai com código ≠ 0 se algum falhar.

### `pnpm verify:full`
- Lint, typecheck, todos os testes (banco isolado com Testcontainers), contrato, build e testes de banco; `--e2e` acrescenta o Playwright.
- Para na primeira falha.
- Só quando pedido ("verificação completa", "rode tudo"), antes de abrir PR e antes de release. O CI sempre roda o full.

### Saída
Resumo final com ✓/✗/pulado e o tempo de cada passo. Implementação em `scripts/verify.mjs`.

## Regras para os agentes
- Toda mudança vem com o teste que a cobre; o nível só decide quanto da suíte roda.
- Ao terminar, diga qual nível rodou e o resultado.
- Subagentes: quick por padrão, full só quando quem delegou pedir.

## Decisões relacionadas
- decisions/0016-testes-dois-niveis.md
