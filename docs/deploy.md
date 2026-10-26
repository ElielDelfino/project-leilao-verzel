# Deploy e produção

Fonte: specs/014 (§Servidor, §Produção, §Segredos, §CI/CD, §Backup), ADR 0023, ADR 0033 (VPS Hostinger, que substitui a 0013 e a 0020) e ADR 0034 (backup e uptime fora da entrega). Variáveis e formatos: [variaveis-de-ambiente.md](variaveis-de-ambiente.md).

Este documento descreve o compose de produção para a VPS (tarefa 129) e a entrega dos segredos. O hardening do servidor e o workflow de deploy chegam com as próximas tarefas do infra da F5. Não há backup agendado nem monitor de uptime na entrega (ADR 0034): só um `pg_dump` manual, descrito no runbook (`docs/operacao.md`, tarefa 130). Onde este texto e a specs/014 divergirem, vale a spec.

## Compose de produção

`infra/docker-compose.prod.yml` sobe Postgres, Redis, API e Caddy. Da raiz do repositório:

```sh
docker compose -p leilao-prod --env-file .env --env-file infra/prod.env \
    -f infra/docker-compose.prod.yml up -d
```

- O projeto se chama `leilao-prod` pelo `name:` do arquivo. O `-p leilao-prod` não é obrigatório (o `.env` não define `COMPOSE_PROJECT_NAME` desde a tarefa 023); os comandos o repetem só para ficar explícito. Os volumes têm nome fixo (`leilao-prod_pgdata` e `leilao-prod_caddy_data`) e nunca se misturam com o `leilao_pgdata` do dev, qualquer que seja o projeto.
- Ordem dos `--env-file`: o `.env` da raiz traz os defaults de dev e o `infra/prod.env` (versionado, sem segredo) vem depois e troca os valores de produção: limites de memória, `CADDY_SITE_ADDRESS=teste-verzel.duckdns.org` e `LEILAO_SECRETS_DIR=/run/leilao/secrets`. Os dois são lidos só com `--env-file`, porque o arquivo do compose fica em `infra/`. Cada interpolação do compose repete o valor de produção como default.
- `API_IMAGE` e `WEB_IMAGE` escolhem as imagens (prod: `ghcr.io/<owner>/leilao-api:<sha>` e `leilao-web:<sha>`, com `pull` e `up -d --no-build`). Sem elas, o compose constrói as imagens locais `leilao-api:local` e `leilao-web:local`. Na VPS nunca há build (ADR 0033, item 5.1).
- Redes: `borda` (Caddy e API, com saída para a Scryfall) e `dados` (`internal`, sem saída: Postgres, Redis, API e os one-shots).
- Só o Caddy publica portas: 80 e 443 TCP, em todas as interfaces do host (IPv4 e IPv6). Postgres e Redis não têm `ports:`; um `ports:` em qualquer outro serviço é defeito, porque porta publicada pelo Docker passa por fora do UFW (specs/014 §Servidor). `scripts/caddy-csp.test.mjs` trava isso.
- TLS: com um host no `CADDY_SITE_ADDRESS`, o Caddy emite e renova o certificado do Let's Encrypt (HTTP-01 na porta 80) e responde em `http://` com redirecionamento permanente (308) para `https://`. Sem HTTP/3: o Caddyfile tem `protocols h1 h2` e o 443/udp não é publicado (o `docker compose ps` lista `443/udp` só como porta exposta pela imagem base, sem `->`). O volume `caddy_data` guarda a conta ACME e os certificados: nunca `down -v` em produção (limite de 5 certificados idênticos por semana).
- CSP do Caddy (`infra/caddy/Caddyfile`): `default-src`, `script-src`, `style-src`, `font-src` e `connect-src` são `'self'`; `img-src` é `'self' data: https://cards.scryfall.io` (ADR 0029, complementa a 0024) para as miniaturas da busca do painel, valendo para o site todo. Nenhuma outra origem externa. Há HSTS, `nosniff` e `frame-ancestors 'none'`.
- O healthcheck do contêiner da API é o `HEALTHCHECK` da imagem (`/api/health/live`); o deploy verifica `https://<host>/api/health/ready` (Postgres + Redis, specs/014 §CI/CD).

### Limites (ADR 0033, item 8)

| Serviço | RAM | RAM + swap | CPU | Outros |
|---|---|---|---|---|
| Postgres | 1 GB | 2 GB | 1 | |
| API | 768 MB | 1,5 GB | 1 | `NODE_OPTIONS=--max-old-space-size=576` no `environment:` |
| Redis | 128 MB | 128 MB | 0,5 | `maxmemory` 96 MB (`REDIS_MAXMEMORY=96mb`), `volatile-lru`, sem persistência |
| Caddy | 128 MB | 128 MB | 0,5 | `GOMEMLIMIT=96MiB` |

Os valores de memória vêm do `infra/prod.env`; os de CPU, do `.env`. Os one-shots usam os mesmos limites da API. Todo serviço tem `read_only`, `tmpfs` em `/run` e `/tmp` com `nosuid,nodev,noexec`, `ulimits.nofile`, `cap_drop: ALL` e `no-new-privileges`.

### Migrations e seed (one-shots, profile `ops`)

```sh
docker compose -p leilao-prod --env-file .env --env-file infra/prod.env \
    -f infra/docker-compose.prod.yml --profile ops run --rm migrate
docker compose -p leilao-prod --env-file .env --env-file infra/prod.env \
    -f infra/docker-compose.prod.yml --profile ops run --rm seed
```

- `migrate` e `seed` usam a imagem da API (`node dist/db/migrate.js` e `node dist/db/seed.js`) e só rodam quando chamados (`profiles: [ops]`); o `up -d` não os sobe. Os dois esperam o Postgres ficar healthy e ficam só na rede `dados`.
- O `migrate` roda antes do `up -d` da API: sem ele, num banco novo, o papel `leilao_api` não tem senha e a API não sobe (28P01). Ele é idempotente: a segunda execução sai com 0 e diz `senha do papel da API já em dia`.
- A imagem da API contém `database/postgres/migrations` em `/app/database/postgres/migrations` (o mesmo layout do repositório, com a API em `/app/apps/api`). Como o `.dockerignore` da raiz deixa `database/` fora do contexto, as migrations entram por um contexto nomeado:
  - no compose, `build.additional_contexts.migrations: ../database/postgres/migrations`;
  - num `docker build` direto (CI), `--build-context migrations=database/postgres/migrations`.
  Sem esse contexto o build falha (`failed to resolve source metadata for docker.io/library/migrations:latest`), nunca gera uma imagem sem as migrations.

### Teste local

Com segredos descartáveis num diretório próprio (os 6 arquivos, uid 1000, 600, sem quebra de linha; diretório 700) e a CA local do Caddy. As variáveis do shell vencem as dos `--env-file`:

```sh
export CADDY_SITE_ADDRESS=localhost LEILAO_SECRETS_DIR=<diretório com os 6 arquivos>
# Porta 80 ocupada no host? CADDY_HTTP_PORT=18080 (o redirecionamento continua indo para https://localhost/).
docker compose -p leilao-prod --env-file .env --env-file infra/prod.env -f infra/docker-compose.prod.yml build
docker compose -p leilao-prod --env-file .env --env-file infra/prod.env -f infra/docker-compose.prod.yml --profile ops run --rm migrate
docker compose -p leilao-prod --env-file .env --env-file infra/prod.env -f infra/docker-compose.prod.yml up -d --no-build --wait
curl -k https://localhost/api/health/ready
```

Para limpar: `docker compose -p leilao-prod -f infra/docker-compose.prod.yml down`, e `docker volume rm leilao-prod_pgdata leilao-prod_caddy_data` só na máquina local.

## Segredos em produção (ADR 0023)

Nenhum segredo passa por `environment:`, `env_file:`, `command:`, healthcheck ou argumento de build. Cada segredo é um arquivo montado pelo Compose `secrets:` em `/run/secrets/<nome>`, e o processo recebe só o caminho em `<VAR>_FILE`.

| Arquivo | Quem recebe (`<VAR>_FILE`) |
|---|---|
| `db_password` | Postgres (`POSTGRES_PASSWORD_FILE`); one-shots `migrate` e `seed` (`DB_PASSWORD_FILE`). **Nunca a API** |
| `db_api_password` | API e one-shot `migrate` (`DB_API_PASSWORD_FILE`) |
| `redis_password` | API (`REDIS_PASSWORD_FILE`); Redis (o entrypoint grava `requirepass` num `redis.conf` em tmpfs) |
| `jwt_secret` | API (`JWT_SECRET_FILE`) |
| `pseudonym_hmac_key` | API (`PSEUDONYM_HMAC_KEY_FILE`) |
| `ed25519_private_key` | API (`ED25519_PRIVATE_KEY_FILE`) |

- São 6 segredos (ADR 0026). Na VPS, a fonte é `/opt/leilao/.env.local` (root, 600, fora do Git), gerado no próprio servidor por `infra/deploy/gerar-env-local.sh` (ADR 0033). Não há Secret Manager.
- A API conecta ao Postgres como o papel `leilao_api` (`POSTGRES_API_USER`, no `environment:`), não recebe `POSTGRES_USER` nem `DB_PASSWORD_FILE` e não monta o secret `db_password`: a senha do dono do banco não chega à API.
- O `migrate` recebe só `DB_PASSWORD_FILE` e `DB_API_PASSWORD_FILE` (aplica a senha do papel da API, ADR 0026). O `seed` recebe só `DB_PASSWORD_FILE`: as etapas de hoje (contas demo) usam apenas `SEED_DEMO_PASSWORD`, que não é segredo. Uma etapa nova que precise de outro segredo acrescenta o secret ao serviço `seed`.
- O diretório no host vem de `LEILAO_SECRETS_DIR` (`/run/leilao/secrets` no `infra/prod.env`). O `config` não acusa a falta de um arquivo.
- Na VPS, `infra/deploy/materializar-segredos.sh` lê o `/opt/leilao/.env.local` e grava `/run/leilao/secrets/<nome>`: tmpfs, diretório 700, arquivos 600 com dono uid 1000 (usuário `node` da imagem da API), sem quebra de linha. Ele roda no boot, por uma unidade systemd ordenada antes do `docker.service` (o tmpfs se perde no reinício), e à mão depois de uma rotação. O `.env.local` nunca é passado ao Compose.
- O Compose ignora `uid`, `gid` e `mode` de secrets com `file:` fora do Swarm: o arquivo entra em bind somente leitura com o dono e o modo do host. Por isso o dono uid 1000 vem do script de materialização; o Postgres e o Redis leem como root no entrypoint, com `DAC_READ_SEARCH` (sem `DAC_OVERRIDE`, como no dev). No host, o uid 1000 é do administrador, nunca do usuário `deploy`.
- Sem um arquivo, o `up` do serviço que o usa falha com `bind source path does not exist: <caminho>` e o deploy aborta, mantendo a versão anterior (specs/001). `docker compose config --quiet` não detecta essa falta.
- A API, o runner de migrations e o seed aceitam exatamente uma de `<VAR>` ou `<VAR>_FILE` por segredo e não sobem com valor fora do formato; a mensagem cita só o nome da variável (specs/014 §Segredos).
- `SEED_DEMO_PASSWORD` não é segredo: vem do `.env` versionado, com o mesmo valor nos três ambientes (specs/003 RF-03).

## Verificar sem expor segredos

- `docker inspect` dos containers de produção não deve conter o valor de nenhum segredo (critério de specs/014): só os caminhos `/run/secrets/<nome>` e as variáveis `<VAR>_FILE`. O método completo (inspect, `compose config`, `docker history`, argv dos processos e journal da materialização, cada valor usado só como padrão de `grep -qF -f`) está em specs/014 §Verificação de vazamento.
- Para validar o compose, use `docker compose -p leilao-prod --env-file .env --env-file infra/prod.env -f infra/docker-compose.prod.yml config --quiet`; sem `--quiet`, a saída imprime o modelo inteiro.
- `cat /opt/leilao/.env.local` e `cat /run/leilao/secrets/<nome>` na VPS, e `docker exec <container> cat /run/secrets/<nome>`, mostram o próprio segredo: não use em terminal compartilhado nem em log.
