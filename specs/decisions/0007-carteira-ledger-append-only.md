# 0007 — Carteira como ledger append-only

Status: aceita
Data: 2026-10-24

## Decisão
Toda movimentação é um lançamento imutável (`ledger_entries`); a projeção `wallet_balances` é atualizada na mesma transação, com CHECK de invariantes; a reconciliação é testada no CI. Detalhes em specs/004.

## Alternativas consideradas
Colunas `total`/`comprometido` atualizadas direto: mais simples, mas sem trilha de auditoria do dinheiro.

## Consequências
O estorno do cancelamento é só mais um tipo de lançamento; a ordem de locks (lote → carteiras por `user_id`) evita deadlock.
