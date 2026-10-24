# 0010 — Redis 8: pub/sub, rate limit e cache

Status: aceita
Data: 2026-10-24

## Decisão
Redis 8.8 (escolha do usuário em vez do Valkey) para o adapter do Socket.IO, o rate limit (endpoints e token bucket da Scryfall) e o cache da Scryfall (24 h). Nada de dinheiro nem de lance mora no Redis. `maxmemory 48mb`, `volatile-lru`, sem persistência.

## Alternativas consideradas
- Valkey 8: equivalente funcional, licença BSD; preterido pelo usuário.
- Sem Redis: impede a escala horizontal e o rate limit global.

## Consequências
Com RNFs de demo e uma instância, o adapter não é estritamente necessário, mas é mantido por custar pouco. Chaves em cache/redis/README.md.
