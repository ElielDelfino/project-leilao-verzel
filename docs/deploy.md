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

| Arquivo | Quem recebe (`<VAR>_FILE`) | No compose |
|---|---|---|
| `db_password` | Postgres (`POSTGRES_PASSWORD_FILE`); one-shots de migrations e seed (`DB_PASSWORD_FILE`). **Nunca a API** | tarefa 007 |
| `db_api_password` | API (`DB_API_PASSWORD_FILE`); one-shot de migrations | tarefa 042 |
| `redis_password` | API (`REDIS_PASSWORD_FILE`); Redis (entrypoint grava `requirepass` num `redis.conf` em tmpfs) | tarefa 007 |
| `jwt_secret` | API (`JWT_SECRET_FILE`) | tarefa 042 |
| `pseudonym_hmac_key` | API (`PSEUDONYM_HMAC_KEY_FILE`); seed | tarefa 042 |
| `ed25519_private_key` | API (`ED25519_PRIVATE_KEY_FILE`); seed | tarefa 042 |

- São 6 segredos, as 6 versões gratuitas do Secret Manager (ADR 0026). O sexto, `DB_API_PASSWORD`, é criado no Secret Manager pela tarefa 008, com a aprovação do humano; a tarefa 042 não cria nem altera nada no GCP.
- A API conecta ao Postgres como o papel `leilao_api` (`POSTGRES_API_USER`, no `environment:`), não recebe `POSTGRES_USER` nem `DB_PASSWORD_FILE` e não monta o secret `db_password`: a senha do dono do banco não chega à API.
- Os one-shots de migrations e de seed (specs/014 §Produção) entram no compose com a tarefa que os criar: o de migrations recebe `DB_PASSWORD_FILE` e `DB_API_PASSWORD_FILE`; o de seed, `DB_PASSWORD_FILE` e os segredos das suas etapas. Hoje o compose não tem nenhum dos dois.
- O diretório no host vem de `LEILAO_SECRETS_DIR`. O padrão `../.secrets` (relativo a `infra/`) é o `.secrets/` do `pnpm keys:generate`, que só cria `db_password` e `redis_password`: para subir a API pelo compose de produção localmente, crie também os outros 4 arquivos (uid 1000, 600, sem quebra de linha); o `config` não acusa a falta. Na VM, `LEILAO_SECRETS_DIR=/run/leilao/secrets`.
- Na VM, `infra/deploy/fetch-secrets.sh` lê os 6 segredos do GCP Secret Manager e grava `/run/leilao/secrets/<nome>`: tmpfs, diretório 700, arquivos 600 com dono uid 1000 (usuário `node` da imagem da API), sem quebra de linha. Ele roda antes do `compose up` em cada deploy e no boot da VM, por uma unidade systemd ordenada antes do `docker.service`, porque o tmpfs se perde no reinício.
- O Compose ignora `uid`, `gid` e `mode` de secrets com `file:` fora do Swarm: o arquivo entra em bind somente leitura com o dono e o modo do host. Por isso o dono uid 1000 vem do `fetch-secrets.sh`; o Postgres e o Redis leem como root no entrypoint.
- Sem um arquivo, o `up` do serviço que o usa falha com `bind source path does not exist: <caminho>` e o deploy aborta, mantendo a versão anterior (specs/001). `docker compose config --quiet` não detecta essa falta.
- A API, o runner de migrations e o seed aceitam exatamente uma de `<VAR>` ou `<VAR>_FILE` por segredo e não sobem com valor fora do formato; a mensagem cita só o nome da variável (specs/014 §Segredos).
- `SEED_DEMO_PASSWORD` não é segredo: vem do `.env` versionado, com o mesmo valor nos três ambientes (specs/003 RF-03).

## Verificar sem expor segredos

- `docker inspect` dos containers de produção não deve conter o valor de nenhum segredo (critério de specs/014): só os caminhos `/run/secrets/<nome>` e as variáveis `<VAR>_FILE`.
- Para validar o compose, use `docker compose -p leilao-prod --env-file .env -f infra/docker-compose.prod.yml config --quiet`; sem `--quiet`, a saída imprime o modelo inteiro.
- `cat /run/leilao/secrets/<nome>` na VM e `docker exec <container> cat /run/secrets/<nome>` mostram o próprio segredo: não use em terminal compartilhado nem em log.
