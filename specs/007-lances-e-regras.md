# 007 — Lances e regras

Status: aprovada
Depende de: 004, 006, 008

## Requisitos (regras do PDF)
- RF-01 Lances só são aceitos em lotes ao vivo (entre início e fim).
- RF-02 O primeiro lance deve ser ≥ lance inicial; os seguintes ≥ lance atual + incremento mínimo.
- RF-03 O líder não pode cobrir o próprio lance.
- RF-04 O lance só é aceito se couber no saldo disponível; o valor do líder fica comprometido e volta ao disponível quando ele é superado.
- RF-05 Anti-sniping: lance aceito nos últimos 2 minutos estende o fim para **agora + 2 minutos** (ADR 0001).
- RF-06 Leiloeiro não dá lance.
- RNF-01 p95 < 300 ms no servidor com 50 licitantes no mesmo lote.
- RNF-02 Rate limit: 10 lances/s por usuário → 429.

## Comportamento
`POST /api/lotes/{id}/lances` com `{valorCentavos}` e `Idempotency-Key` (UUID). Uma transação:
1. `SELECT ... FROM lots WHERE id = $1 FOR UPDATE`.
2. Verificações, nesta ordem (primeira que falhar → 422 com o código):
   | condição | código |
   |---|---|
   | papel ≠ licitante | `LEILOEIRO_NAO_PODE_LANCAR` (403) |
   | cancelado, encerrado ou agora ≥ `fim_em` | `LOTE_ENCERRADO` |
   | agora < `inicio_em` | `LOTE_NAO_INICIADO` |
   | `lider_id` = usuário | `JA_ESTA_GANHANDO` |
   | valor < mínimo (inicial ou atual + incremento) | `LANCE_ABAIXO_DO_MINIMO` (+ `minimoCentavos`) |
   | disponível < valor | `SALDO_INSUFICIENTE` (+ `disponivelCentavos`) |
3. `carteira.comprometer(tx, usuario, valor)` e `carteira.liberar(tx, liderAnterior, lanceAnterior)`.
4. `lances.anexar(tx, ...)`: grava o lance com seq, pseudônimo, hash e assinatura (specs/008).
5. Atualiza o lote: lance atual, líder, total de lances; se `fim_em − agora < 2 min`, então `fim_em = agora + 2 min`.
6. COMMIT → publica os eventos `lance_aceito`, `voce_foi_superado`, `fim_estendido` e `saldo_atualizado` (specs/009).

- Idempotência: unique `(licitante_id, idempotency_key)`; uma repetição devolve a resposta original (200).
- "Agora" é o relógio do Postgres (`clock_timestamp()`) dentro da transação, nunca o do cliente.

### Posição do usuário no lote
Calculada por `lances` (`bids` do próprio módulo + colunas de `lots` lidas pela interface de `lotes`). Valores (ADR 0025):

| posição | condição |
|---|---|
| `ganhando` | lote ao vivo e `lider_id` = usuário |
| `superado` | lote ao vivo, usuário com ao menos um lance no lote e `lider_id` ≠ usuário |
| `venceu` | lote encerrado e `vencedor_id` = usuário |
| `perdeu` | usuário com ao menos um lance no lote e o lote encerrado com outro vencedor ou cancelado |
| `sem_lance` | usuário sem lance no lote (inclui lote agendado) |

Onde aparece: `GET /api/me/lances` (`posicao`, sempre um dos quatro valores com lance) e o ack de `entrar_lote` (`suaPosicao`, specs/009). `GET /api/lotes/{id}` não chama `lances`: devolve só `ganhando` ou `venceu`, das colunas de `lots` (specs/006).

## Interfaces e contratos
- `POST /api/lotes/{id}/lances` → 201 `{lance, lote: {lanceAtualCentavos, fimEm, totalLances}}`
- `GET /api/lotes/{id}/lances?pagina=` (público, pseudonimizado)
- `GET /api/me/lances` (licitante) → lotes em que deu lance, com a posição atual (`posicao`: `ganhando` | `superado` | `venceu` | `perdeu`; §Posição do usuário no lote)

## Dados
- `bids(id uuid pk, lote_id fk, seq int, licitante_id fk, pseudonimo text, valor_centavos bigint, criado_em timestamptz(3), hash_anterior bytea, hash bytea, assinatura bytea, key_id text, idempotency_key uuid)`; unique `(lote_id, seq)`, unique `(licitante_id, idempotency_key)`; trigger append-only.
- Retenção: permanente.

## Critérios de aceite
- [ ] Cada um dos 6 códigos de recusa tem teste de integração.
- [ ] A posição devolvida segue a tabela de §Posição do usuário no lote nos cinco casos (teste de integração, um por valor).
- [ ] 50 lances simultâneos no mesmo lote: seq contígua, sem dois líderes, ledger reconciliado.
- [ ] Lance a 1 min do fim estende para agora + 2 min; lance a 3 min não estende.

## Fora de escopo
Lance automático (proxy bidding), lance por WebSocket.

## Decisões relacionadas
- decisions/0003-monolito-modular.md, 0004-tempo-real-socketio-e-lance-rest.md
