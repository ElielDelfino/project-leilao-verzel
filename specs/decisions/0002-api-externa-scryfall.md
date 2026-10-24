# 0002 — API externa: Scryfall (cartas Magic: The Gathering)

Status: aceita
Data: 2026-10-24

## Contexto
O PDF exige itens vindos de uma API pública. Candidatas testadas ao vivo em 2026-10-24.

## Decisão
Scryfall (`api.scryfall.com`): sem chave, busca devolve a carta completa com imagens de alta qualidade, resposta em ~0,4 s, domínio natural para leilão (cartas raras). Regras de uso respeitadas conforme specs/005.

## Alternativas consideradas
| API | Resultado do teste |
|---|---|
| Art Institute of Chicago | 403 do Cloudflare sem o header `AIC-User-Agent`; limite de 60 req/min |
| Cleveland Museum of Art | OK, sem chave, CC0; era a recomendação inicial |
| V&A | OK, mas lenta (~2,2 s) |
| The Met | endpoint de busca v1 aposentado em 2026-10-01; v1.1 só devolve IDs (N+1) |
| Rijksmuseum | só IDs em Linked Art (N+1) |
| Science Museum | 403 |

## Consequências
- Limite de 2 req/s em `/cards/search`; 429 bloqueia por 30 s → token bucket global e circuito (specs/005).
- Imagens não podem ser cortadas, filtradas ou marcadas; exige o aviso da Fan Content Policy da Wizards.
- Snapshot na criação do lote desacopla o resto do sistema da Scryfall.
