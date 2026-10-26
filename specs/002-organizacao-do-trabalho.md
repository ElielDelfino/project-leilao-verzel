# 002 — Organização do trabalho

Status: aprovada
Depende de: 000, 001

## Ferramenta e orquestração (ADR 0021, modelos pela ADR 0028)
Claude Code. `CLAUDE.md` contém apenas `@AGENTS.md`. Cada papel tem a sua definição em `.claude/agents/<papel>.md`, com modelo e esforço definidos na ADR 0028 (opus só no api-dev e no db-dev), com gate de evidência, formato de relatório fixo e hook `scripts/agents/guard_paths.py` que bloqueia edições fora das pastas do papel.

O trabalho é coordenado pelo **orquestrador** (`claude --agent orquestrador`): ele é o único que altera `tasks/` e fala com o humano; os agentes de papel não conversam entre si e se comunicam só por relatórios. Pedidos entre papéis viram tarefas novas.

## Papéis e propriedade
| Papel | Responsabilidade | Pode alterar |
|---|---|---|
| spec-guardian | specs, ADRs, contratos, docs, CHANGELOG | `specs/`, `specs/decisions/`, `apps/api/openapi.yaml`, `eventbus/`, `docs/`, `CHANGELOG.md`, `README.md` |
| api-dev | módulos da API | `apps/api/` (exceto `openapi.yaml` e `src/**/schema.ts`), `packages/contracts/` (só regeneração) |
| web-dev | SPA | `apps/web/` |
| db-dev | schema, migrations, seeds, Redis | `database/`, `cache/`, `apps/api/src/**/schema.ts` |
| qa | testes de integração, e2e, carga, verificação | `apps/*/test/`, `e2e/`, `load/`, `scripts/verify.mjs` |
| orquestrador | fila, delegação, roteamento, revisões, merges | `tasks/`, `tmp/`, `CHANGELOG.md` |
| infra | CI/CD, Docker, deploy, backup | `infra/`, `.github/`, `docker-compose*.yml`, `.env`, `apps/*/Dockerfile`, `scripts/` (exceto verify) |

Compartilhados por todos os executores: `CHANGELOG.md` (entrada da entrega), `package.json` e `pnpm-lock.yaml` da raiz. Demais configs da raiz (`pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.mjs` etc.) são do infra. Ninguém altera `.claude/`, `scripts/agents/` nem `.env.local`. A regra exata está em `scripts/agents/guard_paths.py`.

**Specs e contratos** só mudam pelo spec-guardian; outros papéis propõem a mudança criando uma tarefa. **Migrations** só pelo db-dev, com revisão do agente `database-reviewer`.

Revisão: agentes globais `code-reviewer` (sempre), `security-reviewer` (auth, carteira, lances, integridade), `database-reviewer` (SQL), `typescript-reviewer`, `react-reviewer`.

## Git e PR
- Trunk-based: `main` sempre implantável.
- Uma branch curta por tarefa, `tipo/nnn-slug` (ex.: `feat/012-aceitar-lance`), num **git worktree** próprio.
- Conventional Commits citando a tarefa: `feat(lances): aceita lance em transação (task 012)`.
- Merge local por lote, PR a cada 3 lotes (ADR 0030, que complementa a 0019 e a 0021):
  - Cada tarefa entra na `main` local como um commit squash, com a mensagem do agente, depois do `code-reviewer` sem CRITICAL/HIGH (e dos demais revisores globais aplicáveis) e da aprovação humana do merge do lote.
  - Ao fechar o lote, `pnpm verify:full` roda na `main` local (com `--e2e` se alguma tarefa do lote mexe em e2e) e vale como o CI do lote.
  - A cada 3 lotes, ou quando o humano pedir: uma branch com os commits acumulados e um PR (título conforme o commitlint, subject em minúsculas). O CI roda uma vez; `gh pr checks` é lido em comando separado e só então o merge, por rebase, com um commit por tarefa; depois a `main` local é alinhada com a remota.
  - O PR periódico é obrigatório: gitleaks, `audit` e CodeQL só rodam no CI.
  - Push e PR só com aprovação humana.
- Agentes de papel não fazem `git add` nem `git commit`; o orquestrador commita na branch da tarefa.
- Conflito: quem faz merge depois faz rebase na `main` e roda `verify:quick` de novo.

## Fluxo das tarefas (`./tasks/`, fora do Git)
1. Problemas encontrados por inspeção ou pedidos entre papéis viram uma nova tarefa, criada pelo orquestrador (template em AGENTS.md).
2. O orquestrador escolhe tarefas `aberta` com todas as `depende-de` concluídas (arquivo removido), em lotes de até 3 sem `arquivos` sobrepostos, e pede aprovação humana.
3. Ele marca `status: em-andamento` e `responsavel`, e entrega o texto integral da tarefa ao agente do papel (em worktree próprio, depois que existir git).
4. O agente devolve o relatório no formato fixo; o orquestrador commita na branch da tarefa, encaminha a revisão aos agentes globais e, com aprovação humana, faz o merge squash na `main` local; o `verify:full` do lote e o PR a cada 3 lotes seguem §Git e PR (ADR 0030). Voltam ao agente no mesmo ciclo só CRITICAL, HIGH e MEDIUM que toque dinheiro, lance, integridade do histórico, auth ou segredos; o resto vai para o hardening da F5 ou para a nota da tarefa futura que mexe no mesmo código. Se o agente original passou de ~150 mil tokens de contexto, a correção vai para um agente novo do mesmo papel, no mesmo worktree, só com o relatório da revisão (ADR 0028).
5. Após o merge, o orquestrador remove o arquivo da tarefa. Tarefa descartada também é removida; se o descarte for uma decisão, vira ADR.
6. No fim da fase, o spec-guardian redige as tarefas da fase seguinte e o orquestrador as grava em `tasks/`.

## Definition of Done
- [ ] Código implementado, dentro dos arquivos da tarefa e das pastas do papel.
- [ ] Testes do nível acordado escritos e passando; `pnpm verify:quick` verde (informar o nível rodado e o resultado).
- [ ] Lint, formatter e checagem de tipos limpos.
- [ ] Spec e contratos atualizados, se mudaram (via spec-guardian).
- [ ] `./docs/` atualizado, quando aplicável.
- [ ] `CHANGELOG.md` com o resumo compactado da entrega.
- [ ] `code-reviewer` sem CRITICAL/HIGH.
- [ ] Arquivo da tarefa removido (pelo orquestrador, após o merge).

## Escalonamento para o humano
Pare e pergunte quando:
- a tarefa conflitar com uma spec ou ADR;
- for preciso mudar `openapi.yaml` ou `asyncapi.yaml`;
- uma migration remover ou alterar colunas existentes;
- for preciso adicionar uma dependência de produção;
- a mudança tocar regras de dinheiro, lance ou integridade do histórico;
- a ação puder gerar custo (VPS, registry ou qualquer serviço externo; ADR 0033);
- um bloqueio durar mais de 15 minutos.

Fora desses casos, siga a recomendação mais conservadora, registre-a na tarefa e prossiga.

## Decisões relacionadas
- decisions/0019-organizacao-agentes-e-git.md, 0021-orquestracao-e-agentes-executores.md, 0028-modelo-e-esforco-por-papel.md, 0030-merge-local-por-lote.md
