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

## Segredos (ADR 0023)
- GCP Secret Manager: `DB_PASSWORD`, `REDIS_PASSWORD`, `JWT_SECRET`, `ED25519_PRIVATE_KEY`, `PSEUDONYM_HMAC_KEY` (5 de 6 versões ativas gratuitas). Ao rotacionar, destrua a versão anterior.
- A conta de serviço da VM tem só `roles/secretmanager.secretAccessor`, sem chave JSON.
- A API valida o env com Zod no boot e falha rápido.

### Origem e formato de cada variável
| Variável | Formato | dev | CI | prod | Spec que a usa |
|---|---|---|---|---|---|
| `DB_PASSWORD` | 32 bytes aleatórios em base64url canônico sem padding (43 caracteres `A–Z a–z 0–9 - _`, ver §Leitura); usada como texto | `.env.local` e cópia em `.secrets/db_password` | GitHub Secrets | Secret Manager → arquivo | §Conexão |
| `REDIS_PASSWORD` | idem | `.env.local` e cópia em `.secrets/redis_password` | GitHub Secrets | Secret Manager → arquivo | §Conexão |
| `JWT_SECRET` | 32 bytes aleatórios em base64url sem padding (43 caracteres); a chave HS256 são os 32 bytes decodificados | `.env.local` | GitHub Secrets | Secret Manager → arquivo | specs/003 §Comportamento |
| `PSEUDONYM_HMAC_KEY` | idem; a chave HMAC-SHA256 são os 32 bytes decodificados | `.env.local` | GitHub Secrets | Secret Manager → arquivo | specs/008 §Chaves |
| `ED25519_PRIVATE_KEY` | seed Ed25519 de 32 bytes (RFC 8032 §5.1.5) em base64url sem padding (43 caracteres) | `.env.local` | GitHub Secrets | Secret Manager → arquivo | specs/008 §Chaves |
| `SEED_DEMO_PASSWORD` | não é segredo: 10 a 128 caracteres `A–Z a–z 0–9 - _`; valor `leilao-demo-2026` | `.env` versionado | `.env` | `.env` | specs/003 RF-03 |

- Não existe `ED25519_KEY_ID`: a API deriva o `keyId` da chave pública (specs/008 §Chaves).
- Todo `.env.local` e todo arquivo de segredo tem permissão 600; nenhum valor tem quebra de linha.
- O `.env` versionado não contém nenhum dos 5 segredos.

### Leitura pela API, pelo runner de migrations e pelo seed
- Para cada um dos 5 segredos, o processo lê **exatamente uma** de `<VAR>` (o valor; dev e CI) ou `<VAR>_FILE` (caminho absoluto do arquivo com o valor; prod).
- O processo não sobe quando: as duas estão definidas; nenhuma está; o arquivo não existe ou não pode ser lido; o valor (da variável ou do arquivo) não está na forma canônica. Forma canônica, igual para os 5: exatamente 43 caracteres `A–Z a–z 0–9 - _`, que decodificam para 32 bytes, e recodificar esses bytes em base64url sem padding reproduz exatamente o mesmo texto (forma canônica; recusa, por exemplo, um último caractere com bits extras). Uma quebra de linha no fim do arquivo também é recusada.
- A mensagem de erro cita só o nome da variável (`<VAR>` ou `<VAR>_FILE`), nunca o valor nem o conteúdo do arquivo.

### Produção
- `infra/deploy/fetch-secrets.sh` lê os 5 segredos do Secret Manager e grava um arquivo por segredo em `/run/leilao/secrets/` (tmpfs; diretório 700; arquivos 600 com dono uid 1000, o usuário `node` da imagem da API; sem quebra de linha): `db_password`, `redis_password`, `jwt_secret`, `pseudonym_hmac_key`, `ed25519_private_key`. Ele roda antes do `compose up` no deploy e no boot da VM, por uma unidade systemd ordenada antes do `docker.service` (o tmpfs se perde no reinício).
- `infra/docker-compose.prod.yml` monta esses arquivos com Compose `secrets:` em `/run/secrets/<nome>` (diretório no host em `LEILAO_SECRETS_DIR=/run/leilao/secrets`). A API e os containers one-shot de migrations e seed recebem só `<VAR>_FILE=/run/secrets/<nome>`; o Postgres lê `POSTGRES_PASSWORD_FILE` e o Redis lê o arquivo no entrypoint, como em dev.
- Nenhum segredo vai em `environment:`, `env_file:`, `command:`, healthcheck ou argumento de build. O Compose ignora `uid`, `gid` e `mode` de secrets com `file:` fora do Swarm (monta o arquivo do host em bind somente leitura), então dono e modo vêm do `fetch-secrets.sh`.
- Sem um arquivo, o `up` do serviço que o usa falha (`bind source path does not exist: <caminho>`) e o deploy aborta (specs/001, dependência do Secret Manager).

### Verificação de vazamento
Um passo do deploy, depois do health check, confere que nenhum segredo aparece nas saídas do Docker, sem nunca exibir o valor:
- Para cada arquivo `/run/leilao/secrets/<nome>`, o valor é usado só como padrão de `grep -qF -f /run/leilao/secrets/<nome>` (o valor não entra no argv do `grep`), aplicado à saída de:
  1. `docker inspect` de todos os containers do projeto (`docker compose -p leilao-prod ps -aq`);
  2. `docker compose -p leilao-prod --env-file .env -f infra/docker-compose.prod.yml config` (modelo completo, sem `--quiet`);
  3. `docker history --no-trunc` das imagens da API e da web;
  4. `ps -eww -o args=` no host, que inclui o argv de todos os processos dos containers.
- Nenhuma dessas saídas vai para o terminal, para arquivo ou para o log: elas só passam pelo pipe até o `grep -q`. O passo não usa `set -x` nem ecoa variáveis.
- O passo relata só o nome do segredo e da fonte (por exemplo, `jwt_secret: docker inspect`) e sai com código 1 se houver qualquer ocorrência; o deploy então falha e volta para a versão anterior, como no health check falho (§CI/CD). Sem ocorrência, relata só `nenhum segredo nas saídas do Docker`.

### Dev
- `pnpm keys:generate` cria `.env.local` (os 5 segredos) e `.secrets/db_password` e `.secrets/redis_password` (cópias para os containers). Os composes de dev montam só esses dois arquivos com Compose `secrets:`; a API roda no host e lê os valores do `.env.local`.
- Sem `.env.local`, `pnpm infra:up` sai com código 1 e `couldn't find env file: <caminho>/.env.local`.
- Sem um arquivo de `.secrets/`, `pnpm infra:up` falha no serviço que o usa com `secret file <projeto>_<nome> does not exist` (aviso) e `bind source path does not exist: <caminho>/.secrets/<nome>`. `docker compose config --quiet` não detecta essa falta (sai 0).
- Mensagens verificadas no Docker Compose 5.5.1 em 2026-10-24; em outra versão, o critério é o `up` falhar citando o caminho do arquivo ausente.

## Conexão da API com Postgres e Redis
A API e o runner de migrations (`pnpm db:migrate`) leem a conexão em partes, com os mesmos nomes dos segredos de ADR 0023 e dos defaults do `.env`. Não existem `DATABASE_URL` nem `REDIS_URL`.

| Destino | Variáveis (todas obrigatórias) | dev (API no host) | prod (API no compose) |
|---|---|---|---|
| Postgres | `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER`, `DB_PASSWORD` | `127.0.0.1`, `15432`, `leilao`, `leilao` (`.env`); senha no `.env.local` | `postgres`, `5432` (nome do serviço e porta interna) no `environment:` do serviço da API; senha por `DB_PASSWORD_FILE=/run/secrets/db_password` (§Segredos) |
| Redis | `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` | `127.0.0.1`, `16379` (`.env`); senha no `.env.local` | `redis`, `6379`, da mesma forma; senha por `REDIS_PASSWORD_FILE=/run/secrets/redis_password` |

- Motivo: o `--env-file` do Node não interpola variáveis, então uma URL completa repetiria a senha no `.env.local` (duas fontes para o mesmo segredo); em produção, ela exigiria um sexto segredo no Secret Manager ou montar a URL no `environment:` do compose, onde a senha aparece no `docker inspect`.
- Os testes trocam só o banco: `POSTGRES_DB=leilao_test` com o banco local (specs/013) ou host e porta do container com Testcontainers.
- Nenhuma dessas variáveis tem default no código: faltando qualquer uma (para as senhas, `<VAR>` ou `<VAR>_FILE`, §Segredos), a API não sobe e a mensagem cita só o nome da variável, nunca o valor.

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
- [ ] Para cada um dos 5 segredos, a API não sobe com `<VAR>` e `<VAR>_FILE` juntos, sem nenhum dos dois, com arquivo ausente, com valor fora da forma canônica de §Leitura (inclusive quebra de linha no fim e um valor de 43 caracteres cuja recodificação difere do texto); a mensagem cita só o nome (teste de unidade do env).
- [ ] Em produção, nenhum dos 5 valores aparece no `docker inspect`, no `docker compose config`, no `docker history` das imagens nem no argv dos processos, pelo método de §Verificação de vazamento (passo do deploy; depende da tarefa 008, infra).
- [ ] Depois de `sudo reboot` da VM, `/api/health/ready` volta a responder 200 em até 5 min sem intervenção (depende da tarefa 008, infra).

## Decisões relacionadas
- decisions/0013-deploy-gcp-e2-micro.md, 0015-segredos-gcp-secret-manager.md (substituída pela 0023), 0017-ci-cd-github-actions.md, 0018-observabilidade-e-backup.md, 0020-host-publico-e-uptime.md, 0023-segredos-em-arquivo-e-formatos.md
