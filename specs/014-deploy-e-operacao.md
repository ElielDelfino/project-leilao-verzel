# 014 — Deploy e operação

Status: aprovada
Depende de: 001, 013

## Ambientes
| Ambiente | Onde | Observação |
|---|---|---|
| dev | máquina local | Postgres e Redis via `pnpm infra:up`; API e web com `pnpm dev` |
| prod | GCP Compute Engine **e2-micro** (us-east1, Always Free) | compose de produção + Caddy |

Sem staging (ADR 0013): só uma e2-micro é gratuita; a paridade vem do compose.

## Produção
- VM Debian 13 com Docker Engine, swap de 2 GB e firewall liberando só 22 (restrito), 80 e 443.
- `infra/docker-compose.prod.yml` inclui Postgres, Redis, API e Caddy, com os limites do `.env` (PG 300 MB, API 300 MB, Redis 64 MB, Caddy 32 MB), `read_only`, `tmpfs /run`, `ulimits` e portas internas.
- Caddy: TLS automático, serve a SPA (`apps/web/dist`, copiada para a imagem do Caddy), proxy de `/api/*` e `/socket.io/*` para a API, headers de segurança (CSP, HSTS, nosniff, frame-ancestors none).
- Host: `<ip>.sslip.io` com TLS automático do Caddy até haver um domínio próprio (ADR 0020, provisória).

## Segredos (ADR 0015)
- GCP Secret Manager: `DB_PASSWORD`, `REDIS_PASSWORD`, `JWT_SECRET`, `ED25519_PRIVATE_KEY`, `PSEUDONYM_HMAC_KEY` (5 de 6 versões ativas gratuitas). Ao rotacionar, destrua a versão anterior.
- A conta de serviço da VM tem só `roles/secretmanager.secretAccessor`, sem chave JSON.
- `infra/deploy/fetch-secrets.sh` grava `/run/leilao/secrets.env` (tmpfs, 600) antes do `compose up`.
- A API valida o env com Zod no boot e falha rápido.

## CI/CD (ADR 0017)
- **PR:** `verify:full --e2e`, k6 smoke, `pnpm audit --audit-level high`, gitleaks; CodeQL e Dependabot habilitados no repositório.
- **main:** build das imagens (`linux/amd64`) → push no GHCR (`ghcr.io/<owner>/leilao-api:<sha>` e `leilao-web:<sha>`) → SSH na VM → `fetch-secrets` → `pnpm migrate` (container one-shot) → `docker compose up -d` → health check em `/api/health/ready` por 60 s → se falhar, volta para a tag anterior e o job falha.
- Tags SemVer (`v0.x`, `v1.0.0` na entrega) geram release no GitHub com o trecho do CHANGELOG.

## Observabilidade (ADR 0018)
- Logs Pino em JSON com `requestId`; sem PII (e-mail mascarado).
- `GET /api/health/live` (processo) e `GET /api/health/ready` (Postgres + Redis).
- Logs do Docker com `json-file`, `max-size=10m`, `max-file=5` e expurgo de 14 dias.
- Uptime check no plano gratuito do UptimeRobot com alerta por e-mail (ADR 0020, provisória).
- Alerta de orçamento do GCP em US$ 1.

## Backup
- Cron diário às 03:00 UTC: `pg_dump -Fc` comprimido em `/var/backups/leilao`, mantendo 7 cópias.
- O CI testa o restore: dump → restore num banco limpo → verificação da auditoria de todos os lotes = íntegro.

## Critérios de aceite
- [ ] Push na main publica a nova versão em < 10 min sem intervenção.
- [ ] Health check falho reverte para a versão anterior.
- [ ] Custo mensal do projeto no GCP = US$ 0.

## Decisões relacionadas
- decisions/0013-deploy-gcp-e2-micro.md, 0015-segredos-gcp-secret-manager.md, 0017-ci-cd-github-actions.md, 0018-observabilidade-e-backup.md, 0020-host-publico-e-uptime.md
