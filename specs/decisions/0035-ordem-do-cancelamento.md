# 0035 — Ordem do cancelamento: selar, estornar e só então cancelar o lote

Status: aceita
Data: 2026-10-26
Decisão: do humano, em 2026-10-26 (revisão da tarefa 106; emenda na tarefa 132)
Complementa: ADR 0025 (não a substitui), como a ADR 0032

## Contexto
A ADR 0025 e a specs/010 §Cancelamento fixavam a sequência lote `FOR UPDATE` → `carteira.estornar` → `lances.selar` → status `cancelado`. O `estorno` grava o `lance_id` do lance do líder (ADR 0032 D4), mas `liquidacao` não pode ler `bids` (um módulo não lê a tabela de outro, specs/001). O único caminho pela interface pública de `lances` para obter esse id é o `ultimoLanceId` que `lances.selar` devolve, já usado pelo encerramento (specs/010). Estornar antes de selar obrigaria a abrir uma consulta nova em `lances` só para isso. As revisões de segurança, banco e código da tarefa 106 (commit 5ff1629) concluíram que a ordem inversa é segura.

## Decisão
No cancelamento, a ordem passa a ser: lote `FOR UPDATE` → `lances.selar` (status `cancelado`) → `carteira.travarCarteiras` e `carteira.estornar` → status `cancelado`. O `lanceId` do estorno é o `ultimoLanceId` devolvido por `selar`.

## O que não muda
- É a mesma transação, com o mesmo `lock_timeout` de 5 s e `statement_timeout` de 10 s, e um único rollback: falha em qualquer passo desfaz selo, estorno e status.
- A ordem de locks continua lote → carteiras em ordem crescente de `user_id` (specs/004, ADR 0031): `selar` só lê `bids` e grava `lot_seals`, sem travar carteira, então não cria ordem nova de locks.
- O selo `cancelado` depende só da cadeia de lances e do lote travado, nunca do ledger.
- `selar` confere o lote travado contra a cadeia antes de gravar; divergência (`LOTE_DIVERGENTE`) desfaz tudo antes de qualquer movimento de dinheiro, o mesmo padrão do encerramento.
- O valor do estorno é o `compromisso` do líder lido sob o lock do lote (`lance_atual_centavos`); nada vem do cliente.
- Lote agendado ou sem lances: sem líder, sem estorno, selo `cancelado` com `totalLances = 0`.
- Eventos só depois do COMMIT; a regra do 409 `LOTE_ENCERRADO` (ADR 0032, item 4) e as respostas 503 não mudam.

## Alternativas consideradas
- **Manter estornar antes de selar (ADR 0025 como escrita):** exigiria ler o id do último lance de outra forma (nova função em `lances` ou leitura de `bids`, que viola a fronteira entre módulos) só para preservar uma ordem que não tem efeito observável dentro de uma transação única.
- **Passar o `lanceId` pelo `lotes`:** `lots` não guarda o id do último lance; guardá-lo seria coluna nova e migration só para isso.

## Consequências
- O cancelamento e o encerramento passam a obter o `lance_id` do ledger do mesmo jeito, pelo retorno de `selar`.
- A specs/010 §Cancelamento (passos 2 e 3 invertidos), a specs/001 (resumo do fluxo) e a specs/008 (retorno de `selar`) refletem a nova ordem.
- A ordem observável de fora (resposta, eventos, estado final) é a mesma; o teste de integração da tarefa 106 (falha forçada no selo ou no estorno deixa tudo como estava) continua valendo.
