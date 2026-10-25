# 0029 — Miniaturas da busca do painel: `img-src` com `https://cards.scryfall.io` só no painel

Status: aceita
Data: 2026-10-25
Decisão: do humano, em 2026-10-25 (tarefa 049, D1 aprovada como recomendada)
Complementa: ADR 0024 (item 4; não a substitui nem a edita)

## Contexto
A specs/005 manda a busca do catálogo devolver `imagemUrl` por carta, para o leiloeiro escolher a carta vendo a miniatura. Nessa etapa a carta ainda não tem snapshot (o snapshot nasce na criação do lote), então não existe `GET /api/imagens/{snapshotId}`; a única fonte da miniatura é a imagem da Scryfall. A CSP de produção é `img-src 'self' data:` (ADR 0024, item 4; `infra/caddy/Caddyfile`) e a própria ADR 0024 diz que "uma imagem de origem externa só entra na CSP com uma decisão nova". Sem esta decisão, o navegador bloquearia as miniaturas em produção.

Fato sobre CSP: ela vale por documento. Uma navegação interna da SPA (React Router) não carrega documento novo e mantém a CSP do documento em que a SPA nasceu. Por isso, restringir o `img-src` por caminho só funciona se a entrada e a saída do painel forem carregamentos completos do documento.

## Decisão
1. O `img-src` ganha **só** `https://cards.scryfall.io` (host exato, sem curinga), e **só** nas respostas de documento de `/painel` e `/painel/*`: `img-src 'self' data: https://cards.scryfall.io`. As demais diretivas e as demais rotas ficam como na ADR 0024 (`img-src 'self' data:`).
2. A SPA carrega o documento por inteiro (não pela navegação interna do React Router) em toda navegação que **entra** em `/painel*` vindo de fora dele ou **sai** dele para fora, para que cada documento receba a CSP da sua rota (specs/012 §Painel do leiloeiro).
3. Todo `<img>` que aponta para `cards.scryfall.io` leva `referrerpolicy="no-referrer"` e `alt` com o nome da carta. A busca usa `image_uris.small` da Scryfall; o servidor devolve a URL como veio da Scryfall (specs/005).
4. Vitrine, detalhe do lote, sala, auditoria e comprovante continuam com `img-src 'self' data:` e usam só `GET /api/imagens/{snapshotId}`. RNF-01 de specs/005 segue valendo: nenhuma dessas telas e nenhuma rota da API chamam a Scryfall para mostrar imagem; o navegador do leiloeiro, no painel, é o único que busca imagem na Scryfall, e `*.scryfall.io` (imagens) não tem limite de requisições (specs/005 §Contexto).
5. A aplicação no `Caddyfile` é da tarefa 064 (infra), não desta ADR.

## Alternativas consideradas
- **B, sem miniatura na busca:** nenhuma mudança de CSP, mas o leiloeiro escolheria a carta só pelo texto (nome, coleção, tipo), pior para cartas com o mesmo nome em várias coleções.
- **C, proxy de imagem na API:** manteria a CSP, mas a API chamaria `*.scryfall.io` a cada miniatura (até 25 por busca), com download, cache e limites a mais numa e2-micro, e quebraria a regra de que só a criação do lote baixa imagem.
- **`img-src` ampliado em todas as rotas:** mais simples (sem carregamento completo do documento na entrada e saída do painel), mas expõe a vitrine pública, a sala e a auditoria a uma origem externa sem necessidade. Fica como opção se o custo do carregamento completo se mostrar alto.
- **`img-src https://*.scryfall.io`:** cobre mais hosts, mas as miniaturas vêm de um host só; host exato é o mínimo.

## Consequências
- A tarefa 064 (infra) acrescenta ao Caddyfile uma CSP própria para `/painel` e `/painel/*`; a specs/014 (item do Caddy) cita a CSP geral, que continua correta para o resto do site.
- Entrar e sair do painel recarrega a página: o estado em memória (cache do TanStack Query) se perde nessa passagem e a sessão é refeita por `GET /api/auth/me`. Aceito.
- O IP do leiloeiro é visto por `cards.scryfall.io` ao carregar miniaturas; o `no-referrer` impede o envio do endereço do site. Aceito: o endereço é público e o IP do leiloeiro vai para um CDN, não para a API da Scryfall.
- Se a Scryfall mudar o host das miniaturas, elas deixam de aparecer no painel (o resto do site não é afetado) até nova decisão.
- Os contratos `openapi.yaml` e `asyncapi.yaml` não mudam por esta ADR.
