# 0032 — Complementos da F4: agendador, latência de encerramento, lançamentos de liquidação e cancelamento vencido

Status: aceita
Data: 2026-10-25
Decisão: do humano, em 2026-10-25 (tarefa 100, itens D1, D2 e D4 do relatório de planejamento da F4; o item sobre o cancelamento vencido complementa a ADR 0025)
Complementa: ADR 0008, ADR 0014 e ADR 0025 (não as substitui)

## Contexto
Ao fechar os contratos da F4 (encerramento, liquidação, cancelamento, comprovante e auditoria), a tarefa 100 achou quatro pontos que as ADRs 0008, 0014 e 0025 e as specs 000, 004, 006 e 010 não fechavam: a specs/010 pede `@nestjs/schedule` (dependência de produção ainda não aprovada pelo humano, specs/002 §Escalonamento); a meta "liquidado no máximo 1 s após o fim" (specs/000 RNF-10) ignora que a varredura de 1 s (ADR 0008) soma até 1 s de espera à transação; os lançamentos de liquidação não tinham chave para impedir débito, crédito ou estorno duplicado do mesmo lote; e a ADR 0025 não dizia o que fazer com o cancelamento de um lote cujo `fim_em` já passou, mas que o job ainda não encerrou.

## Decisão
1. **Agendador com `@nestjs/schedule`** (D1). A dependência de produção `@nestjs/schedule` está aprovada para o job de 1 s da ADR 0008. Regras do agendador (sem sobreposição, ligado só no processo real, falha fechada, erro isolado) estão na specs/010.
2. **Encerramento em até 2 s após `fim_em`** (D2). A varredura continua de 1 s (ADR 0008). O RNF-10 da specs/000 e o RNF-01 da specs/010 passam a "≤ 2 s (p95)": até 1 s de espera pela próxima varredura mais a transação de liquidação. É meta de demo (ADR 0014). A regra de lance não muda: um lance depois de `fim_em` é recusado com `LOTE_ENCERRADO` pelo horário, mesmo antes de o job rodar (specs/006, specs/007). Complementa a ADR 0008 (que dizia "≤ 1 s" nas Consequências).
3. **Lançamentos de liquidação com `lote_id` e `lance_id`, e índice único** (D4). `estorno`, `debito_arremate` e `credito_arremate` gravam `lote_id` e `lance_id` (o lance do líder), como `compromisso` e `liberacao` (ADR 0031 D9). Um índice único parcial `ledger_entries_lote_id_tipo_unico` em `(lote_id, tipo)`, onde `tipo in ('estorno','debito_arremate','credito_arremate')` e `lote_id is not null`, impede que o mesmo lote seja debitado, creditado ou estornado duas vezes; não afeta `compromisso` nem `liberacao`, que repetem por lote. A violação (23505) vira o erro de domínio `ErroDeCarteira` `LIQUIDACAO_JA_PROCESSADA`, com rollback, no mesmo molde do `LANCE_JA_PROCESSADO` (specs/004). A migration só cria objetos novos e não é destrutiva.
4. **Cancelar um lote vencido é 409** (complementa a ADR 0025). Dentro da transação de cancelamento, depois do `FOR UPDATE` do lote, `agora(tx) >= fim_em` responde 409 `LOTE_ENCERRADO`: o status derivado do lote já é `encerrado` (specs/006), então o lote vencido que o job ainda não processou é liquidado pelo job, nunca cancelado.

## Alternativas consideradas
- **D1:** um `setInterval` próprio (sem dependência, mas sem o ciclo de vida do Nest, o desligamento ordenado nem a testabilidade do agendador); BullMQ (ADR 0008 já o descartou).
- **D2:** manter 1 s no RNF e na spec, o que a latência da varredura mais a transação não garante no p95; reduzir a varredura para 500 ms (dobra a carga de consultas na e2-micro, sem pedido do PDF).
- **D4:** conferir "já liquidado" só por leitura do ledger antes de gravar (corrida entre duas instâncias, que só o índice fecha); índice único em `(lote_id, tipo)` sem o filtro de `tipo` (quebraria `compromisso` e `liberacao`).
- **Cancelamento vencido:** deixar cancelar até o job rodar (um lote cujo prazo acabou, com lances válidos, deixaria de ter vencedor por uma corrida com o relógio).

## Consequências
- `@nestjs/schedule` entra como dependência de produção da API (tarefa 107).
- A meta de encerramento de demo fica em 2 s; o teste de latência da F5 mede o p95 contra esse valor.
- A migration da tarefa 102 cria o índice único parcial; a tarefa 103 traduz a violação em `LIQUIDACAO_JA_PROCESSADA`.
- Um leiloeiro que tenta cancelar nos últimos instantes recebe 409 mesmo com o status gravado ainda `ao_vivo`; a tela do painel mostra a mensagem de `LOTE_ENCERRADO` (specs/012).
