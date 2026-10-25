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

## Contratos
Os scripts abaixo chegam com a tarefa 021; até lá, o lint roda com as CLIs fixadas fora do repositório.
- `pnpm contracts:lint`: Redocly CLI no `openapi.yaml` e `@asyncapi/cli validate` no `asyncapi.yaml`; sai com código ≠ 0 se houver qualquer erro.
- `pnpm contracts:check`: regera os tipos em memória e sai com código ≠ 0 se `packages/contracts/src/gerado/` diferir do resultado.
- Os dois rodam no CI e no `verify:full`.

## Dois níveis de verificação (ADR 0016)
### `pnpm verify:quick` (padrão)
- Considera só o que mudou desde `git merge-base HEAD main`: commits, alterações e arquivos novos.
- Formato (`prettier --check`) e lint só nos arquivos alterados; typecheck dos pacotes afetados e dos que dependem deles.
- Testes ligados ao que mudou: o teste alterado ou o de mesmo nome do arquivo-fonte (`src/x.ts` → `test/x.test.ts`), e os testes de banco alterados.
- Não roda build, e2e nem a suíte inteira.
- Aceita testes explícitos: `pnpm verify:quick -- test/lances.test.ts -t "anti-sniping"`. Eles substituem só a seleção automática de testes; formato, lint e typecheck continuam rodando sobre o que mudou.
- Banco local já no ar (`LEILAO_TEST_DB=local`), num banco próprio do worktree: ver §Banco de teste.
- Se o Postgres local estiver fora, tenta `pnpm infra:up` ou mostra o comando.
- Roda todos os passos e sai com código ≠ 0 se algum falhar.

### `pnpm verify:full`
- Formato (`prettier --check` em todo o repositório), lint, typecheck, todos os testes (banco isolado com Testcontainers, `LEILAO_TEST_DB=testcontainers`, a partir da tarefa 030), contrato, build e testes de banco; `--e2e` acrescenta o Playwright.
- Para na primeira falha.
- Só quando pedido ("verificação completa", "rode tudo"), antes de abrir PR e antes de release. O CI sempre roda o full.

### Banco de teste (`LEILAO_TEST_DB`)
- Valores aceitos pelo setup global dos testes: `local` (Postgres de dev já no ar, padrão do quick) e `testcontainers` (container descartável, modo do full). Qualquer outro valor não vazio faz o setup falhar com uma mensagem que cita os dois valores aceitos. Nos arquivos de teste, a variável continua sendo só o sinalizador de que o banco é obrigatório (`apps/api/test/db/ambiente-de-teste.ts`).
- Os testes trocam só `POSTGRES_DB` (modo `local`) ou host e porta do container (modo `testcontainers`); não existe `DATABASE_URL` (specs/014 §Conexão).
- Modo `local`, banco por worktree: cada worktree usa `leilao_test_<sufixo>`, em que `<sufixo>` são os 8 primeiros caracteres hexadecimais (minúsculos) do SHA-256 do caminho absoluto impresso por `git rev-parse --show-toplevel` (sem a quebra de linha). O mesmo worktree gera sempre o mesmo nome; se o comando do git falhar, o setup falha com a mensagem do motivo. Motivo: com um nome fixo, dois worktrees no mesmo projeto Compose apagavam o banco um do outro (`DROP DATABASE ... WITH (FORCE)`).
- O template `leilao_test_tpl` é compartilhado por todos os worktrees: recebe as migrations, fica com `allow_connections false` e é refeito só quando o hash da pasta `database/postgres/migrations` difere do guardado no `COMMENT ON DATABASE`.
- Um advisory lock do Postgres, de chave fixa e tomado sempre na conexão ao mesmo banco (o `POSTGRES_DB` de dev; advisory locks valem por banco), serializa só o preparo: comparar o hash, refazer o template quando preciso e criar o banco do worktree com `CREATE DATABASE leilao_test_<sufixo> TEMPLATE leilao_test_tpl`. Os testes rodam depois de liberado o lock, em paralelo entre worktrees. A espera pelo lock é de até 60 s (a mesma do `db:migrate`); passado esse tempo, o setup falha.
- Cada execução apaga e recria só o banco do próprio worktree; nunca apaga outro `leilao_test_*`. O banco fica no ar depois da execução (para depuração) e é recriado na próxima.
- Worktrees com migrations diferentes refazem o template alternadamente; o resultado continua correto, porque cada clone é feito sob o lock, logo depois da comparação do hash.
- Duas execuções simultâneas no mesmo worktree não são suportadas.
- Bancos órfãos de worktrees removidos não são apagados automaticamente; a limpeza é manual: listar com `SELECT datname FROM pg_database WHERE datname LIKE 'leilao\_test\_%' AND datname <> 'leilao_test_tpl';` e apagar cada um com `DROP DATABASE <nome> WITH (FORCE);`. Nunca usar `docker compose down -v`, que apaga o volume compartilhado.

### Saída
Resumo final com ✓/✗/pulado e o tempo de cada passo. Implementação em `scripts/verify.mjs`.

## Regras para os agentes
- Toda mudança vem com o teste que a cobre; o nível só decide quanto da suíte roda.
- Ao terminar, diga qual nível rodou e o resultado.
- Subagentes: quick por padrão, full só quando quem delegou pedir.

## Decisões relacionadas
- decisions/0016-testes-dois-niveis.md
