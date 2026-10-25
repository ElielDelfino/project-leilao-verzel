# 005 — Catálogo (Scryfall)

Status: aprovada
Depende de: 001

## Contexto
Os itens vêm da Scryfall (`api.scryfall.com`). APIs têm limites e instabilidades: a aplicação não pode ficar inutilizável por causa disso.

Regras verificadas na documentação da Scryfall em 2026-10-24:
- Headers obrigatórios: `User-Agent` fiel ao app (ex.: `LeilaoVerzel/0.1`) e `Accept`.
- Limites rígidos: `/cards/search` e `/cards/named` 2 req/s; demais métodos 10 req/s; `*.scryfall.io` (imagens) sem limite.
- Um 429 bloqueia o acesso por 30 s; ignorar 429 pode causar banimento.
- Pede cache de pelo menos 24 h; proíbe paywall e "simplesmente reempacotar" os dados.
- Imagens: não cortar ou cobrir o crédito do artista e o copyright, não distorcer, não aplicar filtros, não pôr marca d'água.
- Nome e logo: proíbe usar os logos da Scryfall ou o nome dela de modo que sugira endosso; não exige texto de crédito.

## Requisitos
- RF-01 O leiloeiro busca cartas por texto (sintaxe da Scryfall) com paginação.
- RF-02 Ao criar o lote, a API grava um **snapshot** da carta (dados + imagem `normal`) no Postgres.
- RNF-01 Vitrine, sala, auditoria e comprovante nunca chamam a Scryfall.
- RNF-02 Nunca exceder 2 req/s em search nem 10 req/s nos demais (token bucket global no Redis).
- RNF-03 Busca com p95 < 1,5 s (cache hit < 50 ms).

## Comportamento
- Cliente HTTP com timeout de 3 s e 1 retry com backoff só para 5xx de rede (nunca para 429).
- Token bucket por endpoint no Redis (`scryfall:bucket:search` 2/s; `scryfall:bucket:default` 10/s). Sem ficha disponível em 1 s → 503 `CATALOGO_OCUPADO`.
- Circuito: 429 → abre por 30 s; 5 falhas seguidas → abre por 30 s. Aberto → 503 `CATALOGO_INDISPONIVEL` com `tenteNovamenteEm`.
- Cache Redis de 24 h para busca e carta.
- Snapshot: `GET /cards/{id}` e download da imagem `image_uris.normal` (ou `card_faces[0].image_uris.normal` em cartas dupla-face), até 1 MB, só JPEG/PNG. Falha no snapshot → a criação do lote falha com 503 (nada é criado).
- Imagem servida por `GET /api/imagens/{snapshotId}` com `Cache-Control: public, max-age=31536000, immutable` e `ETag` = SHA-256.
- UI: imagem com `object-fit: contain`, sem filtros nem sobreposições; rodapé com o aviso da Wizards of the Coast Fan Content Policy e crédito à Scryfall, com os textos exatos de specs/012 §Rodapé.

## Interfaces e contratos
- `GET /api/catalogo/cartas?q=&pagina=` (leiloeiro) → `{cartas: [{scryfallId, nome, colecao, raridade, tipo, artista, imagemUrl}], meta}` · 503
- `GET /api/imagens/{snapshotId}` (público)
- Interface interna: `catalogo.criarSnapshot(tx, scryfallId) → snapshotId`

## Dados
- `card_snapshots(id uuid pk, scryfall_id uuid, nome, colecao, raridade, tipo, texto_oracle, artista, dados jsonb, imagem bytea, imagem_mime, imagem_sha256 bytea, criado_em)`
- Chaves Redis: cache/redis/README.md
- Retenção: snapshots permanentes (fazem parte do lote e do comprovante).

## Critérios de aceite
- [ ] Com a Scryfall bloqueada (teste com nock/MSW), a vitrine, a sala, a auditoria e o comprovante funcionam.
- [ ] 20 buscas simultâneas nunca geram mais de 2 req/s ao upstream.
- [ ] Um 429 abre o circuito por 30 s.

## Fora de escopo
Bulk data da Scryfall, preços de mercado, outras APIs.

## Decisões relacionadas
- decisions/0002-api-externa-scryfall.md, 0009-imagens-em-bytea.md, 0010-redis.md
