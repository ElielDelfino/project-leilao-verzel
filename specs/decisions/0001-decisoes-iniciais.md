# 0001 — Decisões iniciais (menores)

Status: aceita
Data: 2026-10-24

## Contexto
Decisões pequenas da entrevista de início, agrupadas para não gerar uma ADR por item.

## Decisão
- Idioma: só pt-BR (UI, mensagens, docs, specs). Identificadores de código em inglês ou português, seguindo o framework; códigos de erro em português `SCREAMING_SNAKE_CASE`.
- Dinheiro: centavos inteiros (`bigint` no banco, `number` seguro ≤ 2^53 na API), BRL, nunca float.
- IDs: UUIDv7 via `uuidv7()` nativo do Postgres 18.
- Datas: `timestamptz` em UTC; exibição em `America/Sao_Paulo`.
- Anti-sniping: "estende o fim para +2 minutos" interpretado como **fim = agora + 2 min** (não fim += 2 min). Documentado no README como comportamento.
- Prazo: recebido em 2026-10-22, entrega até 2026-10-29. Escopo completo, **sem plano de corte** (risco aceito pelo usuário).
- LGPD mínima: coleta só de nome, e-mail e senha; pseudônimos em telas públicas; sem exclusão de conta (provisória: revisar se deixar de ser demo).
- Repositório: monorepo pnpm, GitHub público, licença MIT.
- Docs: README detalhado + `./docs/` em markdown, sem site.
- Versionamento: SemVer (`v0.x` até a entrega, `v1.0.0` na submissão); CHANGELOG no formato Keep a Changelog.
- Migrations: SQL versionadas, forward-only, padrão expand-contract; correções por nova migration.
- API sem versionamento na URL até existir consumidor externo.
- Qualidade: ESLint flat + typescript-eslint strict + eslint-plugin-boundaries, Prettier, `tsc --noEmit`, Lefthook (pre-commit) e commitlint (Conventional Commits).
- Segurança: `pnpm audit` (falha em high), CodeQL, Dependabot, gitleaks; Helmet/Caddy (CSP, HSTS); rate limit no login (5/min) e no lance (10/s).
- Retenção: lances, ledger e comprovantes permanentes; logs 14 dias; refresh tokens expirados expurgados diariamente; cache da Scryfall 24 h.
- Sucesso = checklist do avaliador (specs/000).

## Alternativas consideradas
Registradas na entrevista; nenhuma alterava a arquitetura.

## Consequências
Base comum para todas as specs. Mudar qualquer item exige uma nova ADR.
