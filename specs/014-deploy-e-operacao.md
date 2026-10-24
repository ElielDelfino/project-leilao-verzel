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

## Conexão da API com Postgres e Redis
A API e o runner de migrations (`pnpm db:migrate`) leem a conexão em partes, com os mesmos nomes dos segredos de ADR 0015 e dos defaults do `.env`. Não existem `DATABASE_URL` nem `REDIS_URL`.

| Destino | Variáveis (todas obrigatórias) | dev (API no host) | prod (API no compose) |
|---|---|---|---|
| Postgres | `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER`, `DB_PASSWORD` | `127.0.0.1`, `15432`, `leilao`, `leilao` (`.env`); senha no `.env.local` | `postgres`, `5432` (nome do serviço e porta interna) no `environment:` do serviço da API; senha em `/run/leilao/secrets.env` (§Segredos) |
| Redis | `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` | `127.0.0.1`, `16379` (`.env`); senha no `.env.local` | `redis`, `6379`, da mesma forma; senha em `/run/leilao/secrets.env` |

- Motivo: o `--env-file` do Node não interpola variáveis, então uma URL completa repetiria a senha no `.env.local` (duas fontes para o mesmo segredo); em produção, ela exigiria um sexto segredo no Secret Manager ou montar a URL no `environment:` do compose, onde a senha aparece no `docker inspect`.
- Os testes trocam só o banco: `POSTGRES_DB=leilao_test` com o banco local (specs/013) ou host e porta do container com Testcontainers.
- Nenhuma dessas variáveis tem default no código: faltando qualquer uma, a API não sobe e a mensagem cita só o nome da variável, nunca o valor.

## CI/CD (ADR 0017)
- **PR:** `verify:full --e2e`, k6 smoke, `pnpm audit --audit-level high`, gitleaks; CodeQL e Dependabot habilitados no repositório.
- **main:** build das imagens (`linux/amd64`) → push no GHCR (`ghcr.io/<owner>/leilao-api:<sha>` e `leilao-web:<sha>`) → SSH na VM → `fetch-secrets` → `pnpm migrate` (container one-shot) → `docker compose up -d` → health check em `/api/health/ready` por 60 s → se falhar, volta para a tag anterior e o job falha.
- Tags SemVer (`v0.x`, `v1.0.0` na entrega) geram release no GitHub com o trecho do CHANGELOG.

## Observabilidade (ADR 0018)
- Logs Pino em JSON com `requestId`; sem PII (e-mail mascarado).
- `GET /api/health/live` (processo, sem consultar dependências) e `GET /api/health/ready` (Postgres + Redis), ambos públicos. Com sucesso, os dois respondem 200 `{ "sucesso": true, "dados": { "status": "ok" } }`, sem outros campos.
- No `/ready`, cada verificação tem 2 s para responder. Com uma dependência fora, ou sem verificações registradas, responde 503 `INDISPONIVEL` com mensagem fixa e sem `detalhes`: a resposta não diz qual dependência caiu. O nome da dependência e o motivo vão só para o log (warn), sem host nem senha.
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
- [ ] `/api/health/ready` com o Postgres ou o Redis fora → 503 `INDISPONIVEL` sem `detalhes` nem nome da dependência (teste de integração).
- [ ] A API não sobe sem qualquer uma das variáveis de §Conexão da API com Postgres e Redis, e a mensagem cita o nome, não o valor (teste de unidade do env).

## Decisões relacionadas
- decisions/0013-deploy-gcp-e2-micro.md, 0015-segredos-gcp-secret-manager.md, 0017-ci-cd-github-actions.md, 0018-observabilidade-e-backup.md, 0020-host-publico-e-uptime.md
