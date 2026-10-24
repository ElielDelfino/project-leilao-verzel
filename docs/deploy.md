# Deploy e produção

Fonte: specs/014 (§Produção, §Segredos, §CI/CD), ADR 0013, ADR 0020 e ADR 0023. Variáveis e formatos: [variaveis-de-ambiente.md](variaveis-de-ambiente.md). Este documento descreve o compose de produção entregue na tarefa 007 e a entrega dos segredos; o pipeline de deploy na VM chega com as tarefas do infra seguintes.

## Compose de produção

`infra/docker-compose.prod.yml` sobe Postgres, Redis, API e Caddy:

```sh
docker compose -p leilao-prod --env-file .env -f infra/docker-compose.prod.yml up -d
```

- O projeto se chama `leilao-prod`, e o `-p leilao-prod` é obrigatório até a tarefa 023. O `COMPOSE_PROJECT_NAME=leilao` do `.env` tem precedência sobre o `name:` do arquivo; sem o `-p`, o projeto de produção se junta ao de dev e usa os mesmos volumes.
- Os valores não sensíveis (imagens, limites, portas) vêm do `.env` da raiz, lido só com `--env-file`, porque o arquivo fica em `infra/`.
- `API_IMAGE` e `WEB_IMAGE` escolhem as imagens (prod: `ghcr.io/<owner>/leilao-api:<sha>` e `leilao-web:<sha>`). Sem elas, o compose constrói as imagens locais.
- Redes: `borda` (Caddy e API, com saída para a Scryfall) e `dados` (`internal`, sem saída: Postgres, Redis e API).
- Só o Caddy publica portas: 80 e 443 TCP (`CADDY_HTTP_PORT` e `CADDY_HTTPS_PORT` para testes locais). O endereço público vem de `CADDY_SITE_ADDRESS`: em prod, `<ip-com-hifens>.sslip.io` (ADR 0020); o padrão `localhost` usa a CA local do Caddy.
- Limites de RAM (ADR 0024): Postgres 300 MB, API 300 MB, Redis 64 MB e Caddy 64 MB (`GOMEMLIMIT` 48 MiB), 728 MB no total. Só Postgres e API têm swap (2× o limite). O Caddy serve só HTTP/1.1 e HTTP/2, sem 443/udp.
- O healthcheck da API usa `/api/health/live` até a tarefa 017; depois passa a `/api/health/ready` (Postgres + Redis), que é o que o deploy verifica (specs/014 §CI/CD).

## Segredos em produção (ADR 0023)

Nenhum segredo passa por `environment:`, `env_file:`, `command:`, healthcheck ou argumento de build. Cada segredo é um arquivo montado pelo Compose `secrets:` em `/run/secrets/<nome>`, e o processo recebe só o caminho em `<VAR>_FILE`.

| Arquivo | Variável na API | Outros leitores | No compose desde |
|---|---|---|---|
| `db_password` | `DB_PASSWORD_FILE=/run/secrets/db_password` | Postgres (`POSTGRES_PASSWORD_FILE`) | tarefa 007 |
| `redis_password` | `REDIS_PASSWORD_FILE=/run/secrets/redis_password` | Redis (entrypoint grava `requirepass` num `redis.conf` em tmpfs) | tarefa 007 |
| `jwt_secret` | `JWT_SECRET_FILE` | — | quando a API passar a usá-lo (F1) |
| `pseudonym_hmac_key` | `PSEUDONYM_HMAC_KEY_FILE` | seed | quando a API passar a usá-lo (F3) |
| `ed25519_private_key` | `ED25519_PRIVATE_KEY_FILE` | seed | quando a API passar a usá-lo (F3) |

- O diretório no host vem de `LEILAO_SECRETS_DIR`. O padrão `../.secrets` (relativo a `infra/`) é o `.secrets/` do `pnpm keys:generate`, para testar o compose localmente com as senhas de dev. Na VM, `LEILAO_SECRETS_DIR=/run/leilao/secrets`.
- Na VM, `infra/deploy/fetch-secrets.sh` lê os 5 segredos do GCP Secret Manager e grava `/run/leilao/secrets/<nome>`: tmpfs, diretório 700, arquivos 600 com dono uid 1000 (usuário `node` da imagem da API), sem quebra de linha. Ele roda antes do `compose up` em cada deploy e no boot da VM, por uma unidade systemd ordenada antes do `docker.service`, porque o tmpfs se perde no reinício.
- O Compose ignora `uid`, `gid` e `mode` de secrets com `file:` fora do Swarm: o arquivo entra em bind somente leitura com o dono e o modo do host. Por isso o dono uid 1000 vem do `fetch-secrets.sh`; o Postgres e o Redis leem como root no entrypoint.
- Sem um arquivo, o `up` do serviço que o usa falha com `bind source path does not exist: <caminho>` e o deploy aborta, mantendo a versão anterior (specs/001). `docker compose config --quiet` não detecta essa falta.
- A API, o runner de migrations e o seed aceitam exatamente uma de `<VAR>` ou `<VAR>_FILE` por segredo e não sobem com valor fora do formato; a mensagem cita só o nome da variável (specs/014 §Segredos).
- `SEED_DEMO_PASSWORD` não é segredo: vem do `.env` versionado, com o mesmo valor nos três ambientes (specs/003 RF-03).

## Verificar sem expor segredos

- `docker inspect` dos containers de produção não deve conter o valor de nenhum segredo (critério de specs/014): só os caminhos `/run/secrets/<nome>` e as variáveis `<VAR>_FILE`.
- Para validar o compose, use `docker compose -p leilao-prod --env-file .env -f infra/docker-compose.prod.yml config --quiet`; sem `--quiet`, a saída imprime o modelo inteiro.
- `cat /run/leilao/secrets/<nome>` na VM e `docker exec <container> cat /run/secrets/<nome>` mostram o próprio segredo: não use em terminal compartilhado nem em log.
