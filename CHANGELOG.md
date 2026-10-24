# Changelog

Formato [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/), versionamento [SemVer](https://semver.org/lang/pt-BR/). Detalhes das decisões em `specs/decisions/`.

## [Não lançado]

### Adicionado
- Specs 000–014, PLAN, INDEX e ADRs 0001–0019 (entrevista de início).
- Compose de Postgres 18.6 e Redis 8.8; esqueleto AsyncAPI.
- Monorepo pnpm 12 (Node 24), tsconfig estrito, ESLint flat + typescript-eslint strict + boundaries entre os 7 módulos da API, Prettier, Lefthook e commitlint (task 001).
- `pnpm keys:generate`: cria `.env.local` (600, atômico, sem sobrescrever sem `--force`, backup 600 do anterior no `--force`, recusa destino versionável pelo git, sem imprimir valores) com os 7 segredos de dev, incluindo par Ed25519 via `@noble/ed25519`; variáveis em `docs/variaveis-de-ambiente.md` (task 010).
- Esqueleto da SPA (task 005): Vite 8, React 19.3, React Router 8 com as rotas de specs/012 como páginas provisórias, TanStack Query 5, Tailwind 4 com tokens claro/escuro (contraste AA testado), tema salvo no `localStorage` seguindo `prefers-color-scheme`, layout acessível (landmarks, skip link, foco visível, foco no conteúdo ao trocar de rota), rodapé com a Fan Content Policy e crédito à Scryfall, `formatarCentavos` e datas em `America/Sao_Paulo`, proxy de `/api` e `/socket.io` para `localhost:13000`.
- Esqueleto da API NestJS 12 + Fastify (ESM) com prefixo `/api`, os 7 módulos de specs/001 com `index.ts` público, env validado com Zod no boot (`API_PORT`, `LOG_LEVEL`), logs Pino JSON com `requestId` e requisição logada só com método e caminho (sem query), filtro global no envelope de erro com códigos tipados do `openapi.yaml` (4xx do framework mantêm o status com código do catálogo; demais erros viram 500 `INDISPONIVEL`), `detalhes` só com valores primitivos, `GET /api/health/live` e `GET /api/health/ready` (503 `INDISPONIVEL` enquanto as verificações de Postgres e Redis não existem) (task 004).
- Orquestrador e 6 agentes de papel em opus, com gates, relatório fixo e hook de fronteira (`scripts/agents/guard_paths.py`); verificador `scripts/agents/check_specs.py`.

### Decidido
- Cartas Magic via Scryfall; monolito modular NestJS + SPA React; lance REST + Socket.IO.
- Hash chain + Ed25519 + selo; carteira em ledger; encerramento por varredura de 1 s.
- Deploy GCP e2-micro (Always Free); RNFs de demo; segredos no Secret Manager.
