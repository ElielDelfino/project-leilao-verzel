# 0024 — Caddy com 64 MB, swap só para Postgres e API, sem HTTP/3

Status: aceita
Data: 2026-10-24
Decisão: do humano, em 2026-10-24 (ciclo de correção 1 da tarefa 015, a partir do compose de produção da tarefa 007)
Complementa: ADR 0013 (não a substitui)

## Contexto
A specs/014 fixava o limite do Caddy em 32 MB. O Caddy é a porta única do site: termina o TLS, serve a SPA com gzip e faz o proxy de `/api/*` e do WebSocket do `/socket.io/*`. Se ele morrer por OOM, o site inteiro cai. Em repouso, no compose de produção da tarefa 007, ele mede 17,5 MiB, mais da metade do limite antigo, antes de qualquer conexão TLS ou WebSocket aberta. A tarefa 007 também deixou três escolhas que a specs/014 não registrava: swap por container, HTTP/3 e o `img-src` da CSP.

## Decisão
1. **Limite de memória do Caddy: 64 MB** (era 32 MB), sem swap (`memswap_limit` igual ao limite). O teto de heap do Go (`GOMEMLIMIT`) fica em cerca de 48 MiB, abaixo do limite do container, para o GC apertar antes do OOM.
2. **Swap de 2× o limite só para Postgres e API** (`memswap_limit` de 600 MB para 300 MB de RAM). Redis e Caddy ficam sem swap: o Redis é limitado pelo `maxmemory` e não persiste, e o Caddy está no caminho de toda requisição.
3. **HTTP/3 desligado:** o Caddy serve só HTTP/1.1 e HTTP/2 (`protocols h1 h2`), e o compose não publica 443/udp, porque o firewall da VM libera só 80 e 443 TCP (specs/014).
4. **CSP com `img-src 'self' data:`:** as imagens das cartas vêm da própria API (snapshot em bytea, ADR 0009), nunca da Scryfall. `data:` cobre imagens embutidas na SPA.

## Alternativas consideradas
- **Manter 32 MB e medir no k6 contra a VM (F5):** o número viria de medição, mas o risco de OOM fica aberto até a semana da entrega, e a medição chegaria tarde para corrigir com folga.
- **48 MB:** dá mais folga que o limite antigo, mas, na mesma proporção, o GOMEMLIMIT ficaria em ~36 MiB, pouco acima dos 17,5 MiB em repouso, para TLS, gzip e as conexões WebSocket de todos os clientes.
- **Swap também para o Caddy:** evita o OOM, mas troca uma queda por latência alta em toda requisição.
- **HTTP/3:** exige abrir 443/udp no firewall, sem ganho relevante para a demo.

## Consequências
- Soma dos limites de RAM: Postgres 300 + API 300 + Redis 64 + Caddy 64 = 728 MB, dentro dos ~900 MB utilizáveis da e2-micro (1 GB). Sobram ~170 MB para o sistema e o Docker, mais o swap de 2 GB da VM (ADR 0013).
- O `.env` passa a `CADDY_MEM=64m`, `CADDY_MEMSWAP=64m` e `CADDY_GOMEMLIMIT=48MiB` (tarefa do infra).
- O k6 contra a VM (F5) continua sendo o teste que confirma os limites; uma medição do Caddy acima do GOMEMLIMIT sob carga é fato novo para reabrir esta ADR.
- Uma imagem de origem externa só entra na CSP com uma decisão nova.
