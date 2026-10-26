# Casa de Leilões (teste técnico Elite Dev Verzel)

Casa de Leilões online de cartas Magic: The Gathering (dados da Scryfall). Leiloeiros publicam lotes, licitantes disputam com lances ao vivo usando saldo simulado, e qualquer pessoa audita o histórico de lances, protegido contra adulteração por hash chain e assinaturas Ed25519. Entrega até 2026-10-29.

## Fonte da verdade
As especificações em ./specs/ são a fonte da verdade. Toda mudança de comportamento começa pela spec.
Carregue cada spec sob demanda a partir do índice.

@specs/INDEX.md

Leia `specs/PLAN.md` ao escolher a fase ou o lote. Leia `specs/002-organizacao-do-trabalho.md` ao delegar, revisar, fazer merge ou escalar ao humano (papéis, Definition of Done, escalonamento).

## Antes de propor mudanças
Consulte ./specs/decisions/ (comece pelo HISTORY.md). Não reabra uma decisão aceita sem um fato novo. Para mudá-la, proponha uma nova ADR.

## Fluxo de trabalho
- Inicie com `claude --agent orquestrador`. O orquestrador lê ./tasks/, propõe lotes, delega aos agentes de papel (.claude/agents/) e pede sua aprovação antes de cada lote e de cada merge (ADR 0021).
- Agentes de papel recebem a tarefa do orquestrador, trabalham numa branch `tipo/nnn-slug` num git worktree próprio, alteram só os arquivos da tarefa e as pastas do papel (o hook `scripts/agents/guard_paths.py` bloqueia o resto) e devolvem um relatório no formato fixo.
- Commits citam o ID da tarefa, por exemplo `feat(lances): aceita lance em transação (task 012)`. Só o orquestrador altera ./tasks/ e faz merge.
- Consistência de specs, ADRs e tarefas: `python3 scripts/agents/check_specs.py`.

## Testes e verificação
- `pnpm verify:quick` é o padrão: roda lint, typecheck e testes só do que mudou desde `git merge-base HEAD main`, com o banco local via TEMPLATE (`LEILAO_TEST_DB=local`). Testes explícitos: `pnpm verify:quick -- <arquivo> -t "<nome>"`.
- `pnpm verify:full` (`--e2e` para incluir o Playwright) só quando pedido, antes de abrir PR e antes de release. O CI sempre roda o full.
- Toda mudança vem com o teste que a cobre. Ao terminar, diga qual nível rodou e o resultado.
- Subagentes: quick por padrão; full só quando quem delegou pedir.

## Comandos
Os scripts estão no `package.json`. O passo a passo do ambiente local (Node 24.7 ou mais, pnpm 12, `keys:generate`, `infra:up`, `db:migrate`, `db:seed`, `dev`) está no README §Setup local. `pnpm dev` serve a API em :13000 e a web em :15173.

## Regras que não podem ser quebradas
- Dinheiro em centavos inteiros; nunca float.
- Aceitar um lance é uma única transação com `FOR UPDATE` no lote (specs/007).
- `bids`, `lot_seals` e `ledger_entries` são append-only.
- Módulos da API só se comunicam pelas interfaces públicas; nenhum módulo lê a tabela de outro.
- A chave privada Ed25519 e demais segredos nunca vão para o Git, para logs nem para o banco.
- Vitrine, sala, auditoria e comprovante nunca chamam a Scryfall.
- Respostas públicas nunca contêm nome ou e-mail de licitante.

## Onde fica cada coisa
- `./tasks/` (fila de trabalho) e `./tmp/` (relatórios e estado do orquestrador) ficam fora do Git.
- `./docs/` é documentação derivada das specs; na divergência, vale a spec.
- `./scripts/agents/` guarda o hook de fronteira e o verificador de specs.
- `./.claude/agents/` tem o orquestrador e os agentes de papel.
- `./.claude/rules/` tem as convenções por área (`api`, `web`, `banco`), que carregam ao editar aquela área.
- `./.claude/skills/` tem os procedimentos `nova-migracao` e `deploy-e-rollback`.

## Template de tarefa (`./tasks/nnn-titulo.md`)
```markdown
---
id: nnn
status: aberta | em-andamento | bloqueada | em-revisao
responsavel: <papel, vazio se aberta>
fase: <fase do PLAN>
spec: specs/nnn-...md
depende-de: [nnn, nnn]
arquivos: [caminhos que a tarefa pode alterar]
---

# Título

## O que fazer
...

## Critérios de aceite
- [ ] ...
- [ ] Definition of Done (specs/002) atendida
```
