# 0019 — Organização: Claude Code, 6 papéis, trunk-based com worktrees

Status: aceita
Data: 2026-10-24

## Decisão
Claude Code com os papéis spec-guardian, api-dev, web-dev, db-dev, qa e infra (`.claude/agents/`). Revisão pelos agentes globais. Trunk-based, branch e worktree por tarefa, PR com CI verde, squash merge, Conventional Commits citando a tarefa. Lista de escalonamento em specs/002.

## Alternativas consideradas
3 papéis (menos paralelismo); um agente por módulo (conflito em arquivos compartilhados); commits direto na main.

## Consequências
Paralelismo por papel em cada fase do PLAN; só o spec-guardian altera specs e contratos; só o db-dev altera migrations.
