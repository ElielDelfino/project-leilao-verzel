# 0028 — Modelo e esforço por papel e política de custo de tokens

Status: aceita
Data: 2026-10-25
Decisão: do humano, em 2026-10-25 (tarefa 044, custo de tokens na F0)
Substitui parcialmente: ADR 0021 (só o trecho "`model: opus`, `effort: high`" do item 1 da Decisão)

## Contexto
A ADR 0021 pôs todos os papéis em opus com esforço alto. Na F0 o consumo de tokens ficou alto demais para o ritmo do prazo (2026-10-29). Só alguns papéis lidam com regra de dinheiro, lance, auth, concorrência e integridade do histórico, que justificam o modelo mais caro. O resto da ADR 0021 (três camadas, orquestrador hub-and-spoke, hook de fronteira, revisão pelos globais) segue valendo.

## Decisão
1. **Modelo e esforço por papel** (substituem `model: opus`, `effort: high` em todos os papéis):

| Papel | Modelo | Esforço |
|---|---|---|
| orquestrador | sonnet | medium |
| spec-guardian | sonnet | high (opus pontual, por delegação, em decisões pesadas como a da tarefa 036) |
| web-dev | sonnet | medium |
| infra | sonnet | medium |
| qa | sonnet | medium |
| api-dev | opus | medium |
| db-dev | opus | medium |

2. Opus só onde há regra de dinheiro, lance, auth, concorrência e integridade (api-dev e db-dev). Os revisores globais seguem em sonnet.
3. **Revisões:** voltam ao agente no mesmo ciclo só os achados CRITICAL, HIGH e MEDIUM que toquem dinheiro, lance, integridade do histórico, auth ou segredos. Os demais MEDIUM e os LOW vão para o hardening da F5 ou para a nota da tarefa futura que mexe no mesmo código, sem rodada de correção.
4. **Rodada de correção:** se o agente original já passou de ~150 mil tokens de contexto, o orquestrador abre um agente novo do mesmo papel, no mesmo worktree, recebendo só o relatório da revisão, em vez de retomar o antigo. O limite de 2 ciclos de correção da ADR 0021 continua.
5. **Transição:** só o humano altera `.claude/`. Até o humano editar o frontmatter de `.claude/agents/*.md` conforme a tabela, o orquestrador passa o modelo e o esforço em cada delegação.

## Alternativas consideradas
- Manter tudo em opus (ADR 0021): descartada pelo consumo de tokens na F0.
- Tudo em sonnet: descartada; as regras de dinheiro, lance, auth e integridade merecem o modelo mais forte, e um erro ali custa mais do que os tokens.
- Opus fixo no spec-guardian: descartada; ele usa opus só quando o orquestrador delega uma decisão pesada.

## Consequências
- Menor custo por tarefa nos papéis de web, infra, qa, specs e orquestração; os mais sensíveis mantêm o rigor.
- Risco: sonnet pode errar mais em specs densas; mitigado pelo esforço high no spec-guardian, pelo gate de evidência e pela revisão dos globais.
- Achados MEDIUM e LOW fora das áreas sensíveis só são tratados no hardening da F5; a lista fica em `tmp/hardening-f5.md`.
- Complementa a ADR 0019 (papéis, Git e escalonamento continuam valendo).
