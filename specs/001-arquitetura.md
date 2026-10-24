# 001 — Arquitetura

Status: aprovada
Depende de: 000

## Contexto
Um dev, 5 dias, deploy numa VM gratuita de 1 GB. A regra central (aceitar um lance) precisa ser atômica entre lotes, carteira e histórico.

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
| Infra | `infra/` | Caddy, compose de produção, scripts de deploy e backup |

## Módulos da API (monolito modular — ADR 0003)
Cada módulo expõe uma interface pública (`index.ts`) e nada mais; o `eslint-plugin-boundaries` impede imports internos entre módulos. Nenhum módulo lê as tabelas de outro. Operações atômicas entre módulos recebem a mesma transação (`tx`) pelas interfaces.

| Módulo | Dono das tabelas | Spec |
|---|---|---|
| `identidade` | `users`, `refresh_tokens` | 003 |
| `carteira` | `ledger_entries`, `wallet_balances` | 004 |
| `catalogo` | `card_snapshots` (+ chaves Redis `scryfall:*`) | 005 |
| `lotes` | `lots` | 006 |
| `lances` | `bids`, `lot_seals` | 007, 008 |
| `tempo-real` | — (rooms Socket.IO) | 009 |
| `liquidacao` | `receipts` | 010, 011 |

Ordem de dependência permitida: `lances → lotes, carteira, catalogo, identidade`; `liquidacao → lances, lotes, carteira`; `tempo-real` só consome eventos de domínio (EventEmitter interno, publicados após o COMMIT). Ciclos são proibidos.

## Integrações externas
| Integração | Uso | Se falhar |
|---|---|---|
| Scryfall | busca de cartas e snapshot na criação do lote | só a busca do painel fica indisponível (503 `CATALOGO_INDISPONIVEL`); o resto não depende dela (specs/005) |
| GCP Secret Manager | leitura de segredos no deploy | o deploy aborta e mantém a versão anterior (specs/014) |
| GHCR | registro de imagens | o deploy aborta e mantém a versão anterior |

## Autenticação e autorização (ADR 0006, specs/003)
E-mail + senha; JWT de acesso (15 min) + refresh rotativo (7 dias) em cookies httpOnly; CSRF por double-submit; papéis `leiloeiro` e `licitante`, verificados por guard em cada rota. Sem administrador: o seed cria as contas demo.

## Contratos
- REST: `apps/api/openapi.yaml` (OpenAPI 3.1). Fonte da verdade da API; o CI falha se as respostas divergirem (specs/013).
- Tempo real: `eventbus/socketio/asyncapi.yaml` (AsyncAPI 3). O `name` de cada mensagem é o nome do evento Socket.IO.
- Tipos (gerador e scripts chegam com a tarefa 021): `pnpm contracts:gen` gera `packages/contracts/src/gerado/` com o openapi-typescript. Ele lê só OpenAPI, então os tipos do `openapi.yaml` saem direto; para os eventos, o gerador embrulha os payloads das mensagens do `asyncapi.yaml` como `components.schemas` de um OpenAPI 3.1 mínimo (os `$ref` locais continuam válidos) e acrescenta o mapa evento → payload. `apps/api` e `apps/web` importam os tipos de `@leilao/contracts`, sem cópias escritas à mão. Verificação em specs/013 §Contratos.
- Ponto de atenção: `Centavos` (e `Pseudonimo`, quando as rotas da F3 entrarem) é declarado nos dois contratos; uma mudança num deles vale para o outro.
- Envelope de resposta: `{ "sucesso": true, "dados": ... }` ou `{ "sucesso": false, "erro": { "codigo": "SALDO_INSUFICIENTE", "mensagem": "...", "detalhes": {...} } }`; listas paginadas incluem `meta: { total, pagina, limite }`.
- Códigos de erro estáveis em `SCREAMING_SNAKE_CASE`, catalogados no OpenAPI; o front traduz cada código para a mensagem pt-BR (specs/012).

## Stack (ADR 0011, 0012)
Node 24 LTS · pnpm 12 workspaces · TypeScript 6.0.x (provisório) · NestJS 12 + `@nestjs/platform-fastify` · Socket.IO 4.8 + `@socket.io/redis-adapter` · Drizzle ORM 0.45 + drizzle-kit · Zod 4 · argon2 · `@noble/ed25519` · Pino · React 19 · Vite 8 · React Router 8 · TanStack Query 5 · Tailwind 4 · Postgres 18.6 · Redis 8.8 · Vitest 5 · Playwright 1.64 · k6.

## Qualidade e operação (resumo)
- Testes em dois níveis, `verify:quick` e `verify:full` (specs/013, ADR 0016).
- ESLint + boundaries, Prettier, tsc, Lefthook, commitlint (ADR 0001).
- CI/CD no GitHub Actions com deploy automático na main e rollback (specs/014, ADR 0017).
- Logs JSON, health checks, uptime externo, pg_dump diário (ADR 0018).
- Segredos no GCP Secret Manager (ADR 0015).

## Estrutura do repositório
```
apps/api/  apps/web/  packages/contracts/
database/postgres/  cache/redis/  eventbus/socketio/
infra/  scripts/  specs/  docs/  tasks/ (fora do Git)
```

## Decisões relacionadas
- decisions/0003 a 0013, 0015 a 0018
