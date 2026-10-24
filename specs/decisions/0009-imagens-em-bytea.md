# 0009 — Imagens das cartas em bytea no Postgres

Status: aceita
Data: 2026-10-24

## Decisão
Ao criar o lote, a imagem `normal` (~80 KB) é copiada para `card_snapshots.imagem` e servida pela API com `Cache-Control: immutable` e ETag.

## Alternativas consideradas
- Object storage (S3/R2/GCS): mais um serviço e mais credenciais.
- Hotlink no CDN da Scryfall: viola o requisito de funcionar com a API fora.

## Consequências
O banco cresce ~80 KB por lote (irrelevante na escala da demo); entra no backup; o cache HTTP protege o egress de 1 GB/mês.
