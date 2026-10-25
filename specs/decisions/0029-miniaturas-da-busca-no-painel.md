# 0029 — Miniaturas da busca do painel: `img-src` com `https://cards.scryfall.io` no site todo

Status: aceita
Data: 2026-10-25
Decisão: do humano, em 2026-10-25 (tarefa 049, D1; na rodada 2 o humano ampliou a CSP de só `/painel*` para o site todo)
Complementa: ADR 0024 (item 4; não a substitui nem a edita)

## Contexto
A specs/005 manda a busca do catálogo devolver `imagemUrl` por carta, para o leiloeiro escolher a carta vendo a miniatura. Nessa etapa a carta ainda não tem snapshot (o snapshot nasce na criação do lote), então não existe `GET /api/imagens/{snapshotId}`; a única fonte da miniatura é a imagem da Scryfall. A CSP de produção é `img-src 'self' data:` (ADR 0024, item 4; `infra/caddy/Caddyfile`) e a própria ADR 0024 diz que "uma imagem de origem externa só entra na CSP com uma decisão nova". Sem esta decisão, o navegador bloquearia as miniaturas em produção.

Fato sobre CSP: ela vale por documento. Uma navegação interna da SPA (React Router) não carrega documento novo e mantém a CSP do documento em que a SPA nasceu. Por isso, restringir o `img-src` por caminho só funcionaria com carregamento completo do documento a cada entrada e saída do painel; o custo (perder o estado da SPA) não compensa.

## Decisão
1. O `img-src` ganha **só** `https://cards.scryfall.io` (host exato, sem curinga), em **todas as rotas**: `img-src 'self' data: https://cards.scryfall.io`. As demais diretivas ficam como na ADR 0024.
2. Não há carregamento completo do documento ao entrar ou sair do painel: a navegação interna do React Router segue valendo em todo o site. Motivo: a CSP vale por documento e a SPA mantém a do primeiro carregamento; uma CSP por rota exigiria recarregar a página a cada passagem pelo painel.
3. Todo `<img>` que aponta para `cards.scryfall.io` leva `referrerpolicy="no-referrer"` e `alt` com o nome da carta. A busca usa `image_uris.small` da Scryfall; o servidor devolve a URL como veio da Scryfall (specs/005).
4. Só o painel (busca do novo lote) exibe miniaturas de `cards.scryfall.io`. Vitrine, detalhe do lote, sala, auditoria e comprovante usam só `GET /api/imagens/{snapshotId}`. RNF-01 de specs/005 segue valendo e passa a ser garantido pelo código, não pela CSP: nenhuma dessas telas e nenhuma rota da API chamam a Scryfall para mostrar imagem; o navegador do leiloeiro, no painel, é o único que busca imagem na Scryfall, e `*.scryfall.io` (imagens) não tem limite de requisições (specs/005 §Contexto). O critério de teste continua: nenhuma imagem dessas telas tem origem em `cards.scryfall.io`.
5. A aplicação no `Caddyfile` é da tarefa 064 (infra), não desta ADR.

## Alternativas consideradas
- **B, sem miniatura na busca:** nenhuma mudança de CSP, mas o leiloeiro escolheria a carta só pelo texto (nome, coleção, tipo), pior para cartas com o mesmo nome em várias coleções.
- **C, proxy de imagem na API:** manteria a CSP, mas a API chamaria `*.scryfall.io` a cada miniatura (até 25 por busca), com download, cache e limites a mais numa e2-micro, e quebraria a regra de que só a criação do lote baixa imagem.
- **CSP só em `/painel` e `/painel/*`, com carregamento completo do documento ao entrar e sair do painel:** CSP mínima por rota, mas obriga a SPA a recarregar a página a cada passagem pelo painel (perde o estado em memória) e a manter uma função de navegação para isso. Descartada pelo humano na rodada 2.
- **`img-src https://*.scryfall.io`:** cobre mais hosts, mas as miniaturas vêm de um host só; host exato é o mínimo.

## Consequências
- A tarefa 064 (infra) troca no Caddyfile o `img-src` da CSP única do site por `'self' data: https://cards.scryfall.io`; a specs/014 (item do Caddy) cita esse valor.
- A CSP do site todo passa a permitir imagens de um host externo; uma falha de código que ponha um `<img>` da Scryfall fora do painel não seria barrada pela CSP, por isso o teste de componente de specs/012 verifica a origem das imagens de cada tela.
- O IP do leiloeiro é visto por `cards.scryfall.io` ao carregar miniaturas; o `no-referrer` impede o envio do endereço do site. Aceito: o endereço é público e o IP do leiloeiro vai para um CDN, não para a API da Scryfall.
- Se a Scryfall mudar o host das miniaturas, elas deixam de aparecer no painel (o resto do site não é afetado) até nova decisão.
- Os contratos `openapi.yaml` e `asyncapi.yaml` não mudam por esta ADR.
