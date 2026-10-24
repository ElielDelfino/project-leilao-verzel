# Changelog

Formato [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/), versionamento [SemVer](https://semver.org/lang/pt-BR/). Detalhes das decisões em `specs/decisions/`.

## [Não lançado]

### Adicionado
- Specs 000–014, PLAN, INDEX e ADRs 0001–0019 (entrevista de início).
- Compose de Postgres 18.6 e Redis 8.8; esqueleto AsyncAPI.
- Monorepo pnpm 12 (Node 24), tsconfig estrito, ESLint flat + typescript-eslint strict + boundaries entre os 7 módulos da API, Prettier, Lefthook e commitlint (task 001).
- Orquestrador e 6 agentes de papel em opus, com gates, relatório fixo e hook de fronteira (`scripts/agents/guard_paths.py`); verificador `scripts/agents/check_specs.py`.

### Decidido
- Cartas Magic via Scryfall; monolito modular NestJS + SPA React; lance REST + Socket.IO.
- Hash chain + Ed25519 + selo; carteira em ledger; encerramento por varredura de 1 s.
- Deploy GCP e2-micro (Always Free); RNFs de demo; segredos no Secret Manager.
