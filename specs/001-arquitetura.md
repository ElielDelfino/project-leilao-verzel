# 001 — Arquitetura

Status: aprovada
Depende de: 000

## Contexto
Um dev, 5 dias, deploy numa VPS de 1 vCPU e 4 GB (ADR 0033). A regra central (aceitar um lance) precisa ser atômica entre lotes, carteira e histórico.

## Visão geral
```
 navegador (SPA React)  ── REST /api ──►  API NestJS (monolito modular)  ──► Postgres 18
        ▲                                       │  ▲                           (dados, imagens)
        └──── Socket.IO /leilao ◄───────────────┘  └──► Redis 8 (adapter Socket.IO, rate limit, cache)
                                                 └──► Scryfall (só busca e snapshot na criação do lote)
```
Em produção, o Caddy termina o TLS, serve a SPA estática e faz proxy de `/api` e `/socket.io` para a API (specs/014).

## Componentes
| Componente | Pasta | Responsabilidade |
|---|---|---|
| API | `apps/api/` | regras de negócio, REST, Socket.IO, job de encerramento |
| Web | `apps/web/` | SPA React (todas as telas) |
| Contratos | `packages/contracts/` | tipos TS gerados de `apps/api/openapi.yaml` e `eventbus/socketio/asyncapi.yaml` |
| Postgres | `database/postgres/` | persistência; migrations SQL |
| Redis | `cache/redis/` | pub/sub do Socket.IO, rate limit, cache da Scryfall |
| Infra | `infra/` | Caddy, compose de produção, scripts de deploy |

## Módulos da API (monolito modular — ADR 0003)
Cada módulo fica em `apps/api/src/modules/<nome>/`, com `<nome>` igual ao da tabela abaixo, e expõe uma interface pública em `apps/api/src/modules/<nome>/index.ts` e nada mais. Nenhum módulo lê as tabelas de outro. Operações atômicas entre módulos recebem a mesma transação (`tx`) pelas interfaces.

Regra de import (`eslint-plugin-boundaries`, erro de lint): um módulo só importa outro **pelo `index.ts`** e **só se a aresta estiver na ordem de dependência abaixo**, inclusive para `import type`; pasta de `modules/` fora da tabela não importa nem é importada. Imports dentro do mesmo módulo, de código fora de `modules/` (como `apps/api/src/common/`) e de pacotes externos não passam pela regra.

| Módulo | Dono das tabelas | Spec |
|---|---|---|
| `identidade` | `users`, `refresh_tokens` | 003 |
| `carteira` | `ledger_entries`, `wallet_balances` | 004 |
| `catalogo` | `card_snapshots` (+ chaves Redis `scryfall:*`) | 005 |
| `lotes` | `lots` | 006 |
| `lances` | `bids`, `lot_seals` | 007, 008 |
| `tempo-real` | — (rooms Socket.IO) | 009 |
| `liquidacao` | `receipts` | 010, 011 |

Ordem de dependência permitida (`A → B`: A importa a interface pública de B; ADR 0025):

| Módulo | Importa |
|---|---|
| `identidade`, `carteira`, `catalogo` | — |
| `lotes` | `catalogo` |
| `lances` | `lotes`, `carteira`, `catalogo`, `identidade` |
| `liquidacao` | `lances`, `lotes`, `carteira`, `catalogo` |
| `tempo-real` | `lotes`, `lances`, `identidade` |

Ciclos são proibidos (o grafo acima é acíclico: `lotes` não importa `lances` nem `carteira`). Além das arestas, `tempo-real` consome os eventos de domínio (EventEmitter interno, publicados após o COMMIT).

Consequências da tabela:
- **Cancelamento de lote** é de `liquidacao`, não de `lotes`: uma transação com lote `FOR UPDATE` → `carteira.estornar` → `lances.selar` (status `cancelado`) → status `cancelado` (specs/010 §Cancelamento). `lotes` expõe a `liquidacao` as operações de travar o lote e de mudar o status.
- **Guards** `@Papel`, `@Publico` e `@SessaoOpcional` (rota pública que identifica o usuário se houver sessão válida; specs/003) ficam em `apps/api/src/common/auth/` (só metadados); o guard global é registrado por `identidade` via `APP_GUARD`, sem aresta entre módulos.
- **Seed por módulo** (ADR 0027): o `pnpm db:seed` descobre as etapas em `apps/api/src/modules/<nome>/seed.ts`, na ordem da primeira tabela de §Módulos (identidade, carteira, catalogo, lotes, lances, liquidacao; `tempo-real` não tem etapa), e cada etapa é idempotente (rodar duas vezes não duplica linhas nem falha). O seed conecta como dono do banco (specs/014 §Conexão). Uma fase nova adiciona o `seed.ts` do módulo, sem tarefa do db-dev só para registrar etapa.
- **Posição do usuário** (`ganhando`, `superado`, `venceu`, `perdeu`, `sem_lance`): `lotes` usa só as colunas de `lots`; `lances` calcula as cinco (specs/007 §Posição).

## Integrações externas
| Integração | Uso | Se falhar |
|---|---|---|
| Scryfall | busca de cartas e snapshot na criação do lote | só a busca do painel fica indisponível (503 `CATALOGO_INDISPONIVEL`); o resto não depende dela (specs/005) |
| GHCR | registro de imagens | o deploy aborta e mantém a versão anterior |
| Let's Encrypt (pelo Caddy) | certificado TLS de `<subdominio>.duckdns.org` | o certificado vigente continua valendo; o Caddy tenta renovar de novo (specs/014) |
| DuckDNS | registro A do host | o site fica inacessível pelo nome até o DNS voltar; nada no servidor depende dele |

## Autenticação e autorização (ADR 0006, 0022, 0027, specs/003)
E-mail + senha; JWT de acesso (15 min) + refresh rotativo (7 dias) em cookies httpOnly; CSRF por double-submit; papéis `leiloeiro` e `licitante`, verificados por guard em cada rota. Sem administrador: o seed cria as contas demo.

## Contratos
- REST: `apps/api/openapi.yaml` (OpenAPI 3.1). Fonte da verdade da API; o CI falha se as respostas divergirem (specs/013).
- Tempo real: `eventbus/socketio/asyncapi.yaml` (AsyncAPI 3). O `name` de cada mensagem é o nome do evento Socket.IO.
- Tipos (gerador e scripts chegam com a tarefa 021): `pnpm contracts:gen` gera `packages/contracts/src/gerado/` com o openapi-typescript. Ele lê só OpenAPI, então os tipos do `openapi.yaml` saem direto; para os eventos, o gerador embrulha os payloads das mensagens do `asyncapi.yaml` como `components.schemas` de um OpenAPI 3.1 mínimo (os `$ref` locais continuam válidos) e acrescenta o mapa evento → payload. `apps/api` e `apps/web` importam os tipos de `@leilao/contracts`, sem cópias escritas à mão. Verificação em specs/013 §Contratos.
- Ponto de atenção: `Centavos` (e `Pseudonimo`, quando as rotas da F3 entrarem) é declarado nos dois contratos; uma mudança num deles vale para o outro.
- Envelope de resposta: `{ "sucesso": true, "dados": ... }` ou `{ "sucesso": false, "erro": { "codigo": "SALDO_INSUFICIENTE", "mensagem": "...", "detalhes": {...} } }`; listas paginadas incluem `meta: { total, pagina, limite }`.
- Códigos de erro estáveis em `SCREAMING_SNAKE_CASE`, catalogados no OpenAPI; o front traduz cada código para a mensagem pt-BR (specs/012).
- Toda rota do `openapi.yaml` declara as respostas de erro próprias e `default` com o envelope `Erro`, que cobre os casos de §Erros que a rota não lista.

## Erros
Toda exceção vira o envelope de erro de §Contratos, por um filtro global (e, para os erros que o roteador do Fastify responde antes do Nest, pelo handler `frameworkErrors`). Decisões do humano na tarefa 018: erro não tratado responde 500 `INDISPONIVEL`; 403 do framework é `PAPEL_NAO_PERMITIDO` (ADR 0022).

| Origem da exceção | Status | Código | Corpo | Log |
|---|---|---|---|---|
| `ErroApi` lançado por um módulo | o do erro | o do erro | mensagem e `detalhes` do erro | 4xx: sem linha própria (o status aparece na linha `request completed` do Fastify, em info); 5xx: error, com stack |
| `HttpException` do Nest ou erro do Fastify (`code` começando por `FST_ERR_`), com status 4xx | o próprio | tabela abaixo | mensagem fixa do código, sem `detalhes` | warn, só com status, código, tipo do erro e `code` interno; sem mensagem nem stack |
| `HttpException` com status 5xx | o próprio (ex.: 503) | `INDISPONIVEL` | mensagem fixa, sem `detalhes` | error, com stack |
| qualquer outra (erro não tratado, erro de biblioteca, inclusive com `statusCode` 4xx) | 500 | `INDISPONIVEL` | mensagem fixa, sem `detalhes` | error, com stack e `requestId` |

Status 4xx do framework → código do catálogo:

| Status | Casos típicos | Código |
|---|---|---|
| 400, 409, 413, 414, 415, 422 e qualquer 4xx não listado aqui | JSON malformado, URL malformada ou validação do Fastify (400); corpo acima do limite (413); parâmetro de rota longo demais (414); content-type não suportado (415) | `DADOS_INVALIDOS` |
| 401 | | `NAO_AUTENTICADO` |
| 403 | | `PAPEL_NAO_PERMITIDO` |
| 404, 405 | rota inexistente, método não aceito | `NAO_ENCONTRADO` |
| 429 | rate limit | `MUITAS_TENTATIVAS`, sempre com o header `Retry-After` (specs/012 usa o valor na mensagem) |

Regras:
- Só `HttpException` e erros do próprio Fastify mantêm um status 4xx. Erro de biblioteca externa (cliente da Scryfall, driver do banco, cliente Redis) nunca chega ao cliente com o status dela: o módulo o converte em `ErroApi` (ex.: 503 `CATALOGO_INDISPONIVEL`, specs/005); sem conversão, vira 500 `INDISPONIVEL`.
- Erros de domínio com código próprio (`CSRF_INVALIDO`, `EMAIL_EM_USO`, `LOTE_ENCERRADO` etc.) saem sempre por `ErroApi`, nunca por `HttpException`.
- A mensagem dos casos do framework é fixa por código: não reflete a URL, o corpo nem a mensagem da exceção. Nenhuma resposta de erro leva stack, SQL, parâmetros de consulta ou mensagem interna.
- 4xx nunca é logado em error.
- Ainda fora do envelope: as respostas do Fastify no nível do socket (`clientErrorHandler`: 400, 408, 431) e o 503 durante o encerramento (`return503OnClosing`); a tarefa 020 avalia.

## Stack (ADR 0011, 0012, 0027)
Node 24 LTS (≥ 24.7) · pnpm 12 workspaces · TypeScript 6.0.x (provisório) · NestJS 12 + `@nestjs/platform-fastify` · Socket.IO 4.8 + `@socket.io/redis-adapter` · Drizzle ORM 0.45 + drizzle-kit · Zod 4 · argon2id por `node:crypto.argon2` (Node ≥ 24.7.0, `engines.node` `>=24.7 <25`) · `jose` 6.2.13 (JWT HS256) · `@fastify/cookie` 11.1.3 · `@noble/ed25519` · Pino · React 19 · Vite 8 · React Router 8 · TanStack Query 5 · Tailwind 4 · Postgres 18.6 · Redis 8.8 · Vitest 5 · Playwright 1.64 · k6.

## Qualidade e operação (resumo)
- Testes em dois níveis, `verify:quick` e `verify:full` (specs/013, ADR 0016).
- ESLint + boundaries, Prettier, tsc, Lefthook, commitlint (ADR 0001).
- CI/CD no GitHub Actions com deploy automático na main e rollback (specs/014, ADR 0017).
- Logs JSON e health checks (ADR 0018); um `pg_dump` manual antes da entrega, com backup agendado e uptime externo fora do escopo da entrega (ADR 0034).
- Segredos em `/opt/leilao/.env.local` no servidor (600), entregues à API em arquivo e lidos por `<VAR>_FILE` em produção (specs/014 §Segredos, ADR 0023 e ADR 0033).

## Estrutura do repositório
```
apps/api/  apps/web/  packages/contracts/
database/postgres/  cache/redis/  eventbus/socketio/
infra/  scripts/  specs/  docs/  tasks/ (fora do Git)
```

## Decisões relacionadas
- decisions/0003 a 0013, 0015 a 0018 (0015 substituída pela 0023; 0013 substituída pela 0033), 0022, 0023, 0025, 0026, 0027, 0033
