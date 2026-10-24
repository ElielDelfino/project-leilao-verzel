# 0008 — Encerramento por varredura no banco a cada 1 s

Status: aceita
Data: 2026-10-24

## Decisão
Job interno a cada 1 s com `FOR UPDATE SKIP LOCKED` faz agendado → ao vivo e liquida os lotes vencidos, um por transação, de forma idempotente. A regra de lance usa os horários, nunca só o status.

## Alternativas consideradas
- BullMQ com jobs atrasados: cada extensão do anti-sniping exige reagendar.
- Encerramento sob demanda: o leiloeiro e o comprovante esperariam um acesso.
- Cloud Tasks (se fosse Cloud Run): descartado com a ADR 0013.

## Consequências
Latência de encerramento ≤ 1 s; seguro com N instâncias; custo de uma query leve por segundo.
