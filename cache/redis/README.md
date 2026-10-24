# Redis: chaves e TTLs

Fonte da verdade: specs/005, specs/009 e ADR 0010. Nada de dinheiro ou lance mora no Redis.

| Padrão de chave | Dono | TTL | Uso |
|---|---|---|---|
| `scryfall:busca:{sha1(q)}:{pagina}` | catalogo | 24 h | cache da busca na Scryfall |
| `scryfall:carta:{scryfallId}` | catalogo | 24 h | cache de `/cards/{id}` |
| `scryfall:bucket:search` / `scryfall:bucket:default` | catalogo | 1 s | token bucket global (2/s e 10/s) |
| `scryfall:circuito` | catalogo | 30 s | circuito aberto após 429 ou 5 falhas |
| `ratelimit:{rota}:{chave}` | identidade / lances | janela | rate limit (login 5/min, lance 10/s) |
| `socket.io#*` | tempo-real | — | canais do `@socket.io/redis-adapter` |
