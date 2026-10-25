# Redis: chaves e TTLs

Fonte da verdade: specs/005, specs/009 e ADR 0010. Nada de dinheiro ou lance mora no Redis.

| Padrão de chave | Dono | TTL | Uso |
|---|---|---|---|
| `scryfall:busca:{sha1(q)}:{pagina}` | catalogo | 24 h | cache da busca na Scryfall |
| `scryfall:carta:{scryfallId}` | catalogo | 24 h | cache de `/cards/{id}` |
| `scryfall:bucket:search` / `scryfall:bucket:default` | catalogo | 1 s | token bucket global (2/s e 10/s) |
| `scryfall:circuito` | catalogo | 30 s | circuito aberto após 429 ou 5 falhas |
| `ratelimit:cadastro:{ip}` | identidade | 60 s | rate limit do cadastro (janela fixa, D8 da tarefa 036) |
| `ratelimit:login:{ip}:{h}` | identidade | 60 s | rate limit do login; `h` = 16 primeiros hex do SHA-256 do e-mail em minúsculas (o e-mail não vai na chave) |
| `ratelimit:{rota}:{chave}` | lances | janela | rate limit do lance (10/s, specs/007) |

Rate limit da F1 (D8 da tarefa 036): janela fixa de 60 s com `INCR` e `EXPIRE ... NX` atômicos;
o TTL restante é o `Retry-After` (≥ 1). Nos testes, o reset é por prefixo com `SCAN` + `DEL`,
nunca `FLUSHDB` nem `FLUSHALL` (o Redis de dev é compartilhado pelos worktrees).
| `socket.io#*` | tempo-real | — | canais do `@socket.io/redis-adapter` |
