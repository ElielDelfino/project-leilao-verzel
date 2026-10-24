# 0014 — RNFs de demo (50 por lote, p95 < 300 ms)

Status: provisória (revisar se o deploy sair da e2-micro)
Data: 2026-10-24

## Contexto
O usuário escolheu inicialmente metas rígidas (500 por lote, p95 < 100 ms, carga no CI). Com o deploy na e2-micro (ADR 0013), elas são inatingíveis em produção.

## Decisão
Rebaixar em todos os ambientes: 50 simultâneos por lote, 200 no total, lance p95 < 300 ms, tempo real < 1 s. O k6 roda como smoke no CI e contra a VM antes da entrega.

## Alternativas consideradas
- Meta rígida no CI e reduzida em produção.
- Trocar o deploy para manter as metas rígidas.

## Consequências
Teste de carga mais simples; a arquitetura continua preparada para escalar (adapter Redis, SKIP LOCKED).
