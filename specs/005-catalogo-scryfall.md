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
- RF-01 O leiloeiro busca cartas por texto (sintaxe da Scryfall) com paginação de 25 cartas por página.
- RF-02 Ao criar o lote, a API grava um **snapshot** da carta (dados + imagem `normal`) no Postgres.
- RNF-01 Vitrine, detalhe do lote, sala, auditoria e comprovante nunca chamam a Scryfall (nem a API da Scryfall, nem o download de imagem). A única imagem da Scryfall que um navegador carrega é a miniatura da busca do painel do leiloeiro (ADR 0029).
- RNF-02 Nunca exceder 2 req/s em search nem 10 req/s nos demais, em qualquer janela de 1 s (token bucket global no Redis, sem rajada).
- RNF-03 Busca com p95 < 1,5 s (cache hit < 50 ms).

## Comportamento

### Busca (`GET /api/catalogo/cartas`)
- Parâmetros: `q` (1 a 200 caracteres, sem espaços nas pontas; obrigatório) e `pagina` (inteiro de 1 a 500; padrão 1). Fora disso: 422 `DADOS_INVALIDOS` com `detalhes.campo` = `q` ou `pagina`. Sintaxe de busca que a Scryfall recusa (HTTP 400 dela) → 422 com `detalhes.campo` = `q`.
- Tamanho da página: **25 cartas**. A Scryfall devolve até 175 cartas por página (175 = 7 × 25), então cada página dela rende 7 páginas nossas: página Scryfall = `ceil(pagina / 7)`; a resposta é o trecho da lista daquela página que começa no índice `((pagina − 1) mod 7) × 25` e tem até 25 cartas. A consulta fixa `unique=cards` e `order=name` (paginação estável).
- `meta` = `{total: total_cards da Scryfall, pagina, limite: 25}`. Scryfall 404 (nenhuma carta, ou página além da última) → 200 com lista vazia e `total` 0.
- Cada carta: `scryfallId`, `nome`, `colecao` (nome da coleção), `raridade`, `tipo` (`type_line`), `artista`, `imagemUrl` (`image_uris.small`, ou `card_faces[0].image_uris.small` em dupla-face; `null` se a carta não tiver imagem). A URL é a da Scryfall, sem passar pelo servidor (ADR 0029).
- Ordem das etapas, parando na primeira que responder:
  1. validação (422);
  2. cache Redis `scryfall:busca:{sha1(q)}:{paginaScryfall}` (o hit responde mesmo com o circuito aberto: o 503 vale só para quem precisaria ir ao upstream). O valor guardado é a projeção da página Scryfall inteira (até 175 cartas) e o `total`; resultado vazio também é guardado;
  3. circuito aberto → 503 `CATALOGO_INDISPONIVEL`;
  4. ficha do bucket (espera até 1 s) → sem ficha, 503 `CATALOGO_OCUPADO`;
  5. chamada à Scryfall.
- Redis indisponível → 503 `CATALOGO_INDISPONIVEL` sem chamar a Scryfall, porque sem o bucket o limite de 2 req/s não é garantido.
- Todo 503 de catálogo leva `detalhes.tenteNovamenteEm` (segundos inteiros ≥ 1) e o header `Retry-After` com o mesmo valor: `CATALOGO_OCUPADO` → 1; circuito aberto → TTL restante do circuito, arredondado para cima; Redis fora, ou falha do upstream sem circuito aberto → 5.

### Cliente HTTP, bucket e circuito
- Cliente HTTP com timeout de 3 s e 1 retry com backoff fixo de 200 ms só para 5xx de rede e timeout (nunca para 429). Headers `User-Agent` = `SCRYFALL_USER_AGENT` e `Accept`. Base da API = `SCRYFALL_BASE_URL` (opcional, padrão `https://api.scryfall.com`; só para teste e e2e, `docs/variaveis-de-ambiente.md`).
- Token bucket por endpoint no Redis (`scryfall:bucket:search`, `scryfall:bucket:default`), **sem rajada**: capacidade de 1 ficha, com reposição de 1 ficha a cada 500 ms (search) e a cada 100 ms (default). É a forma conservadora de garantir "nunca exceder 2 req/s e 10 req/s" em qualquer janela de 1 s. Cada tentativa ao upstream consome uma ficha, inclusive o retry. O download da imagem não consome ficha.
- Circuito: 429 → abre por 30 s; 5 falhas seguidas (timeout, erro de rede ou 5xx depois do retry; contador na memória do processo, zerado por qualquer sucesso) → abre por 30 s. Aberto → 503 `CATALOGO_INDISPONIVEL`. Estado em `scryfall:circuito`.
- Cache Redis de 24 h para busca (`scryfall:busca:*`) e carta (`scryfall:carta:{scryfallId}`).

### Snapshot
- Duas etapas, para a chamada externa não ficar dentro da transação do banco: `catalogo.prepararSnapshot(scryfallId)` (rede e Redis, sem `tx`) e `catalogo.gravarSnapshot(tx, preparado)` (só o INSERT). Falha no preparo → a criação do lote falha e nada é criado (tudo ou nada).
- O preparo obtém `GET /cards/{id}` (cache `scryfall:carta:{scryfallId}`; mesmas regras de circuito e de Redis fora da busca, com o bucket `default`) e baixa `image_uris.normal` (ou `card_faces[0].image_uris.normal` em dupla-face), até 1 MB (1.048.576 bytes), só JPEG/PNG.
- Download da imagem: só `https` e host `*.scryfall.io`; com `SCRYFALL_BASE_URL` sobrescrita, a origem dela (esquema, host e porta) também entra. Sem seguir redirecionamento (resposta 3xx falha). O `Content-Type` precisa ser `image/jpeg` ou `image/png` **e** os primeiros bytes precisam ser os magic bytes do tipo (JPEG `FF D8 FF`; PNG `89 50 4E 47 0D 0A 1A 0A`). O `imagem_mime` gravado é o confirmado e o `imagem_sha256` é o SHA-256 dos bytes.
- Erros do preparo: `scryfallId` que não é UUID, carta inexistente (404 da Scryfall) ou carta sem imagem `normal` → 422 `DADOS_INVALIDOS` com `detalhes.campo` = `scryfallId`; imagem fora da allowlist, grande demais, de tipo inválido ou com falha de download, circuito aberto, bucket sem ficha ou Redis fora → 503 (`CATALOGO_INDISPONIVEL` ou `CATALOGO_OCUPADO`, com `tenteNovamenteEm` como acima).

### Imagem do snapshot
`GET /api/imagens/{snapshotId}` (público) devolve os bytes com `Content-Type` = `imagem_mime`, `Cache-Control: public, max-age=31536000, immutable` e `ETag` = SHA-256 em hexadecimal minúsculo entre aspas (`"<64 hex>"`). Com `If-None-Match` igual ao `ETag` → 304 sem corpo (com `ETag` e `Cache-Control`). Id inexistente ou que não é UUID → 404 `NAO_ENCONTRADO`.

### UI
Imagem com `object-fit: contain`, sem filtros nem sobreposições; rodapé com o aviso da Wizards of the Coast Fan Content Policy e crédito à Scryfall, com os textos exatos de specs/012 §Rodapé. As miniaturas da busca (painel) vêm direto de `cards.scryfall.io`, com `referrerpolicy="no-referrer"` (ADR 0029); todas as outras imagens vêm de `GET /api/imagens/{snapshotId}`.

## Interfaces e contratos
- `GET /api/catalogo/cartas?q=&pagina=` (leiloeiro) → 200 `dados` = `[{scryfallId, nome, colecao, raridade, tipo, artista, imagemUrl}]` + `meta {total, pagina, limite: 25}` · 401 · 403 `PAPEL_NAO_PERMITIDO` · 422 · 503 `CATALOGO_OCUPADO` | `CATALOGO_INDISPONIVEL`
- `GET /api/imagens/{snapshotId}` (público) → 200 (`image/jpeg` ou `image/png`) · 304 · 404
- Interface interna (ADR 0025): `catalogo.prepararSnapshot(scryfallId) → SnapshotPreparado` (rede, sem `tx`); `catalogo.gravarSnapshot(tx, preparado) → snapshotId`; `catalogo.obterSnapshot(snapshotId)` devolve os campos do snapshot sem a imagem (`scryfallId`, `nome`, `colecao`, `raridade`, `tipo`, `textoOracle`, `artista`), usada por `lotes` no detalhe do lote e por `liquidacao` no comprovante; a imagem sai por `GET /api/imagens/{snapshotId}`.

## Dados
- `card_snapshots(id uuid pk, scryfall_id uuid, nome, colecao, raridade, tipo, texto_oracle, artista, dados jsonb, imagem bytea, imagem_mime, imagem_sha256 bytea, criado_em)`
- Chaves Redis: cache/redis/README.md
- Variáveis: `SCRYFALL_USER_AGENT` (já no `.env`) e `SCRYFALL_BASE_URL` (opcional); docs/variaveis-de-ambiente.md.
- Retenção: snapshots permanentes (fazem parte do lote e do comprovante).

## Critérios de aceite
- [ ] Com a Scryfall bloqueada (servidor HTTP falso que recusa tudo), a vitrine, o detalhe do lote, a sala, a auditoria e o comprovante funcionam.
- [ ] 20 buscas simultâneas com `q` diferentes nunca geram mais de 2 req/s ao upstream (nenhuma janela de 1 s com mais de 2 chamadas a `/cards/search`); as que ficam sem ficha em 1 s respondem 503 `CATALOGO_OCUPADO` com `tenteNovamenteEm` 1 e `Retry-After` 1.
- [ ] Um 429 abre o circuito por 30 s; durante esse tempo uma busca sem cache responde 503 `CATALOGO_INDISPONIVEL` com `tenteNovamenteEm` entre 1 e 30, e uma busca com cache responde 200.
- [ ] 5 falhas seguidas (5xx) abrem o circuito; um sucesso entre elas zera a contagem.
- [ ] Paginação: `pagina` 1 e 7 usam a página Scryfall 1 (cartas 0–24 e 150–174); `pagina` 8 usa a página 2 (cartas 0–24); `meta.limite` = 25; `pagina` 501, `q` vazio e `q` com 201 caracteres → 422 com `detalhes.campo`.
- [ ] Redis fora → 503 `CATALOGO_INDISPONIVEL` sem nenhuma chamada ao upstream.
- [ ] Snapshot: carta dupla-face usa `card_faces[0]`; imagem acima de 1 MB, com `Content-Type` fora de JPEG/PNG, com magic bytes que não batem, em host fora da allowlist, em `http` ou com redirecionamento falha o preparo e nada é gravado; `scryfallId` inexistente → 422 com `detalhes.campo` `scryfallId`.
- [ ] O download da imagem não consome ficha do bucket.
- [ ] `GET /api/imagens/{snapshotId}` devolve `Cache-Control: public, max-age=31536000, immutable` e o `ETag` igual ao SHA-256 dos bytes; `If-None-Match` igual → 304 sem corpo; id inexistente → 404.

## Fora de escopo
Bulk data da Scryfall, preços de mercado, outras APIs.

## Decisões relacionadas
- decisions/0002-api-externa-scryfall.md, 0009-imagens-em-bytea.md, 0010-redis.md, 0024-limites-do-caddy-swap-e-http3.md, 0025-cancelamento-em-liquidacao-e-arestas-dos-modulos.md, 0029-miniaturas-da-busca-no-painel.md
