# 0030 — Merge local por lote e PR a cada 3 lotes

Status: aceita
Data: 2026-10-25
Decisão: do humano, em 2026-10-25 (lote F2-B; formalizada na tarefa 069)
Complementa: ADR 0019 (Git e PR) e ADR 0021 (aprovações do orquestrador); não as revoga

## Contexto
A ADR 0019 e a specs/002 mandavam um PR por tarefa, com CI verde e squash merge. Na F2 isso serializou o trabalho: três PRs em sequência, cada um esperando o CI, travavam o lote seguinte. A partir do lote F2-B (2026-10-25), o humano passou a integrar de outra forma, e a specs/002 ficou desatualizada em relação à prática.

Os revisores globais (`code-reviewer`, `security-reviewer`, `database-reviewer` e os de linguagem) já rodam antes do merge, e o `pnpm verify:full` local cobre o que o CI cobre, exceto gitleaks, `audit` e CodeQL.

## Decisão
1. **Merge local por tarefa.** Depois dos revisores globais e da aprovação humana do merge do lote, cada tarefa entra na `main` local como **um commit squash**, com a mensagem do agente (Conventional Commits citando a tarefa).
2. **O CI do lote é o `verify:full` local.** Ao fechar o lote, `pnpm verify:full` roda na `main` local (com `--e2e` quando alguma tarefa do lote mexe em e2e) e vale como o CI daquele lote. Falhou: o lote não está fechado; a correção volta como tarefa ou ciclo do mesmo lote.
3. **PR a cada 3 lotes**, ou quando o humano pedir:
   - uma branch com os commits acumulados e um PR (o título segue o commitlint, com o subject em minúsculas);
   - o CI roda uma vez; o orquestrador lê `gh pr checks` **em comando separado** do merge;
   - só então o merge, **por rebase**, preservando um commit por tarefa; depois a `main` local é alinhada com a remota.
4. **O PR periódico continua obrigatório**, porque é ele que roda o que o `verify:full` local não cobre: gitleaks, `audit` e CodeQL.
5. **Aprovação humana** continua antes de cada lote, de cada merge local e de cada push ou PR (ADR 0021).
6. **Quem commita.** Os agentes de papel rodam pelo runner do Claude Agent SDK, com API credits, e **não fazem `git add` nem `git commit`**: o orquestrador commita na branch da tarefa antes do merge.

## Alternativas consideradas
- Manter um PR por tarefa (ADR 0019): preserva o CI por tarefa, mas serializa os lotes e foi o que travou a F2.
- Um PR por lote: reduz a espera, mas ainda gera um PR e um CI por lote; o `verify:full` local já cobre quase tudo.
- Merge local sem nunca abrir PR: descartada; gitleaks, `audit` e CodeQL só rodam no CI.
- Squash do PR inteiro: perderia a rastreabilidade de um commit por tarefa.

## Consequências
- A `main` local pode estar até 3 lotes à frente da remota; um defeito que só o CI pegaria (segredo no histórico, dependência vulnerável, alerta do CodeQL) aparece no PR periódico, e não na tarefa que o causou. Mitigação: o PR a cada 3 lotes e o pedido do humano a qualquer momento (por exemplo, antes de uma release).
- Fora do PR periódico a `main` do GitHub não é a fonte mais recente; "main sempre implantável" vale para a `main` local depois do `verify:full` do lote e para a remota depois do PR.
- O push não é feito pelo agente de papel nem sem aprovação humana.
- O repositório não tem branch protection; a disciplina de ler o CI antes do merge é do orquestrador.
- O fluxo é prática em vigor desde o lote F2-B; esta ADR a formaliza, sem efeito retroativo sobre os merges anteriores (um PR por tarefa, até a F2-A).
