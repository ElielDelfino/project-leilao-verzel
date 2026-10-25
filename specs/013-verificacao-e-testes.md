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
- Valores aceitos pelo setup global dos testes: `local` (Postgres de dev já no ar, padrão do quick) e `testcontainers` (container descartável, modo do full). Qualquer outro valor não vazio faz o setup falhar com a mensagem `LEILAO_TEST_DB inválido: use "local" ou "testcontainers"`. Com `LEILAO_TEST_DB` vazio ou ausente, o setup não prepara banco nenhum; os testes de banco seguem a regra de `apps/api/test/db/ambiente-de-teste.ts`, em que a variável é só o sinalizador de que o banco é obrigatório (sem ela, faltando alguma variável de conexão, eles são pulados).
- Os testes trocam só `POSTGRES_DB` (modo `local`) ou host, porta e banco do container (modo `testcontainers`); não existe `DATABASE_URL` (specs/014 §Conexão).

#### Modo `testcontainers`
- Sem template, sem sufixo e sem advisory lock: cada execução sobe o próprio container Postgres 18.6 com um banco único, o setup aplica as migrations nele e exporta a conexão em partes (`POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER` e `DB_PASSWORD`). O container é removido no teardown do setup global.
- Transição: até a tarefa 030, o `verify:full` usa o modo `local` (banco do worktree via template).

#### Modo `local`
- Banco por worktree: cada worktree usa `leilao_test_<sufixo>`. O `<sufixo>` são os 8 primeiros caracteres hexadecimais (minúsculos) do SHA-256 dos bytes UTF-8 do caminho exatamente como `git rev-parse --show-toplevel` o imprime, sem a quebra de linha final e sem `realpath` nem outra normalização. O mesmo worktree gera sempre o mesmo nome; se o comando do git falhar, o setup falha com a mensagem do motivo. Motivo: com um nome fixo, dois worktrees no mesmo projeto Compose apagavam o banco um do outro (`DROP DATABASE ... WITH (FORCE)`).
- Guarda: o `POSTGRES_DB` recebido pelo setup é a conexão de administração e a do lock; se ele começar com `leilao_test` (o template ou qualquer `leilao_test_*`), o setup falha antes de conectar, com a mensagem `POSTGRES_DB não pode ser um banco de teste (leilao_test*): use o banco de dev`.
- O template `leilao_test_tpl` é compartilhado por todos os worktrees: recebe as migrations, fica com `allow_connections false` e é refeito só quando o hash da pasta `database/postgres/migrations` difere do guardado no `COMMENT ON DATABASE`.
- Advisory lock: chave fixa `3_011_000_001`, distinta da do `db:migrate` (`3_003_000_001`); toda chave nova de advisory lock no projeto deve ser diferente das já usadas. É tomado com `pg_advisory_lock` numa conexão ao `POSTGRES_DB` de dev (advisory locks valem por banco). A espera é limitada por `lock_timeout` de 60 s, como no `migrate.ts`, e o `lock_timeout` é restaurado (`RESET lock_timeout`) logo depois de adquirir o lock. Se o tempo esgotar, o setup falha com a mensagem `lock do banco de teste não obtido em 60 s: outra execução está preparando leilao_test_tpl; tente de novo`.
- Seção crítica (dentro do lock, nesta ordem): comparar o hash; refazer o template quando preciso; apagar o banco do próprio worktree (`DROP DATABASE IF EXISTS leilao_test_<sufixo> WITH (FORCE)`); cloná-lo com `CREATE DATABASE leilao_test_<sufixo> TEMPLATE leilao_test_tpl`. O lock é liberado em seguida, e os testes rodam fora dele, em paralelo entre worktrees.
- O setup nunca apaga outro `leilao_test_*`. O banco do worktree fica no ar depois da execução (para depuração) e é recriado na próxima.
- Worktrees com migrations diferentes refazem o template alternadamente; o resultado continua correto, porque cada clone é feito sob o lock, logo depois da comparação do hash.
- Duas execuções simultâneas no mesmo worktree não são suportadas.
- Órfãos: bancos de worktrees removidos ou movidos (um worktree movido gera um sufixo novo e deixa o antigo órfão) e o `leilao_test` sem sufixo, que sobrou da tarefa 011, não são apagados automaticamente. A limpeza é manual: listar com `SELECT datname FROM pg_database WHERE datname LIKE 'leilao\_test%' AND datname <> 'leilao_test_tpl';` e apagar cada um com `DROP DATABASE <nome> WITH (FORCE);`. O `WITH (FORCE)` derruba as conexões abertas, então apagar o banco de um worktree que ainda existe interrompe os testes dele. Nunca usar `docker compose down -v`, que apaga o volume compartilhado.

### Saída
Resumo final com ✓/✗/pulado e o tempo de cada passo. Implementação em `scripts/verify.mjs`.

## Regras para os agentes
- Toda mudança vem com o teste que a cobre; o nível só decide quanto da suíte roda.
- Ao terminar, diga qual nível rodou e o resultado.
- Subagentes: quick por padrão, full só quando quem delegou pedir.

## Decisões relacionadas
- decisions/0016-testes-dois-niveis.md
