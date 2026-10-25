# 0021 — Orquestrador hub-and-spoke e agentes executores com três camadas

Status: parcialmente substituída por 0028 (só o modelo e o esforço do item 1; ver 0028-modelo-e-esforco-por-papel.md)
Data: 2026-10-24

## Contexto
Os agentes da ADR 0019 tinham só `name` e `description`: herdavam todas as ferramentas, não tinham processo nem formato de saída, e a propriedade das pastas era só um pedido no texto. O usuário pediu agentes no nível dos agentes do plugin ECC, todos em opus, e um orquestrador para que os agentes trabalhem em conjunto.

Fatos da documentação do Claude Code (code.claude.com/docs/en/sub-agents, consultada em 2026-10-24): sem `tools`, o subagente herda todas as ferramentas; um subagente comum começa com contexto novo; `hooks` funcionam em agentes de projeto (são ignorados só em agentes de plugin); `AskUserQuestion` é removido dos subagentes; `initialPrompt` vale quando o agente roda como sessão principal via `--agent`.

## Decisão
1. **Três camadas em cada agente executor:**
   - frontmatter com `tools` explícito, `model: opus`, `effort: high`, `maxTurns` e `skills` pré-carregadas;
   - prompt com processo numerado, gate de evidência (rastreabilidade à spec, fronteira, ADR, API confirmada na versão, teste primeiro), gate de entrega, anti-padrões do papel e formato de relatório fixo;
   - hook `PreToolUse` (`scripts/agents/guard_paths.py <papel>`) que bloqueia Edit/Write fora das pastas do papel, em `.claude/`, `scripts/agents/` e `.env.local` (falha fechada).
2. **Orquestrador** (`.claude/agents/orquestrador.md`), rodando como sessão principal com `claude --agent orquestrador`:
   - é o único que mexe em `tasks/` e o único que fala com o humano;
   - delega em lotes de até 3 tarefas sem sobreposição de `arquivos`, com `isolation: worktree` a partir da existência do git;
   - transforma "Pedidos a outros papéis" em novas tarefas, encaminha revisões aos agentes globais e limita a 2 ciclos de correção;
   - tem pontos de controle humanos antes de cada lote, de merge/push/PR, nos itens de escalonamento e no fim de fase.
3. **Revisão** continua com os agentes globais (code-reviewer, typescript-reviewer, react-reviewer, database-reviewer, security-reviewer, e2e-runner, pr-test-analyzer).
4. `scripts/agents/check_specs.py` verifica a consistência de specs, ADRs, tarefas e links.

## Alternativas consideradas
- Agentes conversando diretamente entre si (SendMessage par a par): risco de decisões fora das specs sem o humano ver, e edição concorrente dos mesmos arquivos.
- Só agentes globais: não conhecem specs, propriedade nem regras do projeto.
- Workflow determinístico (ferramenta Workflow): exige opt-in a cada execução; pode ser usado depois para lotes grandes.
- `isolation: worktree` fixo no frontmatter: falharia na tarefa 001, antes do `git init`; por isso o orquestrador passa o isolamento por chamada.

## Consequências
- Custo maior (opus em todos os papéis); mitigado pelo limite de 3 executores por lote e pela aprovação humana de cada lote.
- O hook não cobre escrita via Bash (`sed -i`, `>`); a proibição está no prompt e a revisão do diff é a última barreira.
- Complementa a ADR 0019 (papéis, Git e escalonamento continuam valendo).
