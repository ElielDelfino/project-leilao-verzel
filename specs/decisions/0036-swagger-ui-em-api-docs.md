# 0036 — Swagger UI self-hosted em `/api/docs`, sem mudar a CSP

Status: aceita
Data: 2026-10-28
Decisão: do humano, em 2026-10-28 (tarefa 143 da F5; `servers` e dependências decididos na mesma data, depois da primeira rodada da tarefa)
Complementa: ADR 0024 (item 4) e ADR 0029 (não as substitui nem as reabre)

## Contexto
O contrato REST é o `apps/api/openapi.yaml`, escrito à mão e fonte da verdade da API (specs/001 §Contratos). Hoje ele só pode ser lido no repositório; o humano quer a documentação navegável no próprio site, inclusive em produção. A CSP do site é única e vale também para as respostas de `/api/*`, porque o bloco `header` do Caddyfile cobre o site todo: `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://cards.scryfall.io; connect-src 'self'; ...` (ADR 0024 item 4, ADR 0029, specs/014 §Produção). Fato informado pelo humano: o Scalar exige estilo inline e quebraria `style-src 'self'`. A página do Swagger UI carrega CSS e JS só de arquivos externos, sem `<style>` nem `<script>` inline.

## Decisão
1. **Duas rotas na API, públicas e abertas em produção:**
   - `GET /api/docs` responde a página do Swagger UI;
   - `GET /api/docs/json` responde o `openapi.yaml` convertido para JSON.

   As duas rotas não exigem sessão nem CSRF e ficam fora do próprio `openapi.yaml`: não são operações do contrato.
2. **O contrato continua escrito à mão.** Nada de `@nestjs/swagger` nem de decorators: `/api/docs/json` devolve o mesmo documento do `openapi.yaml` que vai na imagem da API, sem gerar nada a partir do código. O `@fastify/swagger` entra só em modo `static`, lendo o arquivo (item 7).
3. **Swagger UI self-hosted, no lugar do Scalar.** A API serve os assets do Swagger UI na própria origem, sob `/api/docs/`, sem CDN. A configuração é fixa num arquivo `.js` servido pela API, nunca inline:
   - `url: '/api/docs/json'`;
   - `validatorUrl: null` (sem o selo do validador externo, que a CSP bloquearia);
   - `queryConfigEnabled: false` (a página ignora `?url=` e `?configUrl=`, então não carrega contrato de outra origem).
4. **CSP intocada (ADR 0024 e 0029 valem como estão).** `/api/docs*` passa pelo `handle /api/*` do Caddy, sem rota, header nem exceção próprios. A página usa só `'self'` para script, estilo, imagem, fonte e `fetch`.
5. **Imagem da API:** o `openapi.yaml` entra na imagem de produção e é a fonte de `/api/docs/json`. Os assets do Swagger UI vêm de uma versão exata fixada no lockfile.
6. **`servers: [{ url: / }]`, com os `paths` intactos** (`openapi.yaml` 0.6.1). O "Try it out" chama a mesma origem da página: em `https://<host>/api/docs`, o de `GET /api/lotes` chama `https://<host>/api/lotes`, nunca `localhost` nem outro host.
   - **Por que não `/api`:** as 24 chaves de `paths` já começam com `/api`. O OpenAPI 3.1 (§4.8.1) monta a URL com o `servers` seguido do path. O Swagger UI faz o mesmo: o `swagger-js` concatena os dois e só tira a barra final do `servers` (`buildOas3UrlWithContext` e `buildRequest` em `src/execute/index.js`). Com `/api`, o "Try it out" chamaria `/api/api/lotes`. Com `/`, a barra cai e a URL fica `/api/lotes`.
   - **O que não muda:** os `paths`, os tipos de `@leilao/contracts` e o validador de contrato dos testes (`apps/api/test/helpers/contrato.ts`).
   - **Alcance do "Try it out":** só é garantido nas rotas públicas. As autenticadas dependem do cookie de sessão. As que alteram estado exigem também `X-CSRF-Token`, que o Swagger UI não envia; sem ele, falham com 403 `CSRF_INVALIDO`. Essas rotas ficam só documentadas.
7. **Dependências de produção da API, aprovadas pelo humano, com versão exata:** `swagger-ui-dist`, `@fastify/swagger` (só em modo `static`, com o `openapi.yaml` como especificação) e `@fastify/swagger-ui`.
   - O pacote `yaml` **não** entra em produção.
   - Quem lê o YAML é o `@fastify/swagger` em modo `static`, e a tarefa de implementação confirma se ele faz isso sozinho.
   - Se ele não ler YAML sozinho, a escolha volta ao humano antes de qualquer dependência nova (specs/002 §Escalonamento).

## Alternativas consideradas
- **Scalar:** exige estilo inline. Mantê-lo pediria `style-src 'unsafe-inline'` ou um nonce em todo o site. Isso enfraquece a CSP do site inteiro, e não só da documentação, porque a CSP é única (ADR 0029, fato sobre CSP por documento).
- **Swagger UI por CDN (unpkg, jsDelivr):** exige uma origem externa em `script-src` e `style-src`. Isso também muda a CSP e põe o código da página nas mãos de terceiros.
- **`@nestjs/swagger` com decorators:** geraria o contrato a partir do código e criaria uma segunda fonte da verdade, ao lado do `openapi.yaml` escrito à mão (specs/001 §Contratos).
- **Documentação só em dev, ou atrás de login:** o humano quer a documentação pública na URL entregue.
- **Rota própria no Caddy servindo o Swagger UI da imagem da web:** acopla o contrato da API ao build da web, e a página continuaria sujeita à mesma CSP. Não traz ganho.

## Consequências
- A specs/001 §Contratos descreve as duas rotas. A specs/014 §Produção diz que `/api/docs*` passa pelo proxy `/api/*` com a CSP de sempre e que o `openapi.yaml` vai na imagem da API.
- A implementação fica com o api-dev (tarefa 144) e o infra: rotas, assets e `openapi.yaml` no estágio final da imagem da API. O `openapi.yaml` passa a 0.6.1, só com a mudança de `servers` e da descrição. `paths` e schemas não mudam, e os tipos de `@leilao/contracts` continuam os mesmos.
- O validador de contrato de specs/013 não cobre `/api/docs*`, porque essas rotas não são operações do `openapi.yaml`. O teste delas é próprio: status, `content-type` e igualdade entre `/api/docs/json` e o YAML lido.
- Qualquer pessoa na internet lê o contrato. Ele não contém segredo, e as rotas que ele descreve já são as mesmas que a SPA chama.
- Uma falha de XSS no Swagger UI rodaria na mesma origem dos cookies de sessão. Três coisas limitam esse risco: a versão exata fixada (atualizações pelo Dependabot, specs/014 §CI/CD), `queryConfigEnabled: false` e a CSP sem `'unsafe-inline'`. Uma versão nova que exija `'unsafe-inline'` ou uma origem externa é um fato novo, e só entra com uma nova ADR.
