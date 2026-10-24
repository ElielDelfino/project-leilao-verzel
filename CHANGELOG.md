# Changelog

Formato [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/), versionamento [SemVer](https://semver.org/lang/pt-BR/). Detalhes das decisões em `specs/decisions/`.

## [Não lançado]

### Adicionado
- Specs 000–014, PLAN, INDEX e ADRs 0001–0019 (entrevista de início).
- Compose de Postgres 18.6 e Redis 8.8; esqueleto AsyncAPI.
- Monorepo pnpm 12 (Node 24), tsconfig estrito, ESLint flat + typescript-eslint strict + boundaries entre os 7 módulos da API, Prettier, Lefthook e commitlint (task 001).
- `pnpm keys:generate`: cria `.env.local` (600, atômico, sem sobrescrever sem `--force`, backup 600 do anterior no `--force`, recusa destino versionável pelo git, sem imprimir valores) com os 7 segredos de dev, incluindo par Ed25519 via `@noble/ed25519`; variáveis em `docs/variaveis-de-ambiente.md` (task 010).
- `pnpm infra:up`: compose de dev validado (Postgres 18.6 e Redis 8.8 healthy em ~6 s); senhas via Compose `secrets:` em `.secrets/` (600, gerados pelo `keys:generate`), portas só em 127.0.0.1, `cap_drop: ALL` com capabilities mínimas, `no-new-privileges`, limite de pids, Redis sem persistência; setup em `docs/dev-setup.md` (task 002).
- Esqueleto da SPA (task 005): Vite 8, React 19.3, React Router 8 com as rotas de specs/012 como páginas provisórias, TanStack Query 5, Tailwind 4 com tokens claro/escuro (contraste AA testado), tema salvo no `localStorage` seguindo `prefers-color-scheme`, layout acessível (landmarks, skip link, foco visível, foco no conteúdo ao trocar de rota), rodapé com a Fan Content Policy e crédito à Scryfall, `formatarCentavos` e datas em `America/Sao_Paulo`, proxy de `/api` e `/socket.io` para `localhost:13000`.
- Esqueleto da API NestJS 12 + Fastify (ESM) com prefixo `/api`, os 7 módulos de specs/001 com `index.ts` público, env validado com Zod no boot (`API_PORT`, `LOG_LEVEL`), logs Pino JSON com `requestId` e requisição logada só com método e caminho (sem query), filtro global no envelope de erro com códigos tipados do `openapi.yaml` (4xx do framework mantêm o status com código do catálogo; demais erros viram 500 `INDISPONIVEL`), `detalhes` só com valores primitivos, `GET /api/health/live` e `GET /api/health/ready` (503 `INDISPONIVEL` enquanto as verificações de Postgres e Redis não existem) (task 004).
- Contratos da F1 (task 009): `openapi.yaml` 0.2.0 com as rotas de auth (csrf, cadastro, login, refresh, logout, me) e carteira (saldo, depósito idempotente, extrato de 20 por página), schemas fechados (`additionalProperties: false`), atributos dos cookies, CSRF, `Retry-After` nos 429 e respostas de erro por código, com o código novo `PAPEL_NAO_PERMITIDO` (403); `asyncapi.yaml` 0.2.0 com o nome do evento em cada mensagem; specs/003 e specs/004 registram as decisões (cookie `refresh_token` em `Path=/api/auth`, rate limit do cadastro, idempotência do depósito); specs/001 e specs/013 descrevem a geração de tipos e os scripts `contracts:*`, que chegam com a tarefa 021.
- Orquestrador e 6 agentes de papel em opus, com gates, relatório fixo e hook de fronteira (`scripts/agents/guard_paths.py`); verificador `scripts/agents/check_specs.py`.

### Decidido
- Cartas Magic via Scryfall; monolito modular NestJS + SPA React; lance REST + Socket.IO.
- Hash chain + Ed25519 + selo; carteira em ledger; encerramento por varredura de 1 s.
- Deploy GCP e2-micro (Always Free); RNFs de demo; segredos no Secret Manager.
