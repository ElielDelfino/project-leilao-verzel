# Setup local de desenvolvimento

Fonte: specs/014 §Ambientes (dev: Postgres e Redis via `pnpm infra:up`; API e web com `pnpm dev`), ADR 0010 (Redis) e ADR 0015 (segredos). Variáveis e segredos: [variaveis-de-ambiente.md](variaveis-de-ambiente.md).

## Pré-requisitos

| Ferramenta | Versão | Observação |
|---|---|---|
| Node | 24 LTS | `.nvmrc`; `nvm use` na raiz |
| pnpm | 12 | fixado em `packageManager` do `package.json` |
| Docker Engine + Docker Compose | Compose com suporte a `include` e a `--env-file` repetido | testado com Docker 29.8.1 e Compose 5.5.1 |

## Passo a passo

```sh
pnpm install          # dependências e git hooks (lefthook)
pnpm keys:generate    # cria .env.local (600) com os segredos de dev; não regera se já existe
pnpm infra:up         # sobe Postgres e Redis em segundo plano
docker compose ps     # os dois serviços devem aparecer como "healthy" em poucos segundos
```

`pnpm infra:up` é `docker compose --env-file .env --env-file .env.local up -d`. O compose sozinho só lê o `.env` (defaults não sensíveis, versionado); os segredos ficam no `.env.local` (fora do Git), por isso os dois arquivos são passados explicitamente. Em ordem: o `.env.local` sobrescreve o `.env`.

`pnpm dev` (API em :13000, web em :15173), `pnpm db:migrate` e `pnpm db:seed` dependem das tarefas da fase F0 e F1 e ainda podem ser stubs.

## O que sobe

O `docker-compose.yml` da raiz só inclui o compose de cada sistema; o nome do projeto é `leilao` (`COMPOSE_PROJECT_NAME` no `.env`).

| Serviço | Imagem | Porta no host | Dados | Limites (padrão do `.env`) |
|---|---|---|---|---|
| Postgres | `postgres:18.6-alpine` | 15432 | volume `leilao_pgdata` em `/var/lib/postgresql` | 1 CPU, 300 MB, `nofile` 4096 |
| Redis | `redis:8.8.3-alpine` | 16379 | nenhum: sem persistência (ADR 0010) | 0,5 CPU, 64 MB, `maxmemory 48mb`, `nofile` 4096 |

- Conexão com o Postgres: `postgres://leilao:<DB_PASSWORD>@localhost:15432/leilao` (usuário e banco vêm de `POSTGRES_USER` e `POSTGRES_DB`).
- Conexão com o Redis: `localhost:16379` com a senha `REDIS_PASSWORD`. Sem senha, o Redis responde `NOAUTH`.
- Os dois containers rodam com `read_only: true`; só gravam no volume e nos `tmpfs` (`/run`, `/tmp` e, no Postgres, `/var/run/postgresql`).
- No Postgres 18 a imagem grava os dados em `/var/lib/postgresql/18/docker` (`PGDATA`), por isso o volume é montado em `/var/lib/postgresql`, não em `/var/lib/postgresql/data` como até a versão 17.
- A senha do Redis não aparece no argv do processo nem no `docker inspect`: o entrypoint a grava num `redis.conf` em `/run/redis` (tmpfs, permissão 600, dono `redis`) e o healthcheck usa `REDISCLI_AUTH`.
- O Redis não guarda nada entre reinícios (`save ""`, `appendonly no`, sem volume): cache, rate limit e circuito da Scryfall recomeçam vazios.

## Parar e limpar

```sh
docker compose stop      # para, mantém os dados
docker compose down      # remove os containers, mantém o volume
docker compose down -v   # remove também o volume do Postgres (apaga os dados de dev)
docker compose logs -f   # acompanha os logs
```

Esses subcomandos funcionam só com o `.env` (testado com Compose 5.5.1). `up` e `config` exigem os segredos (`${VAR:?}`) e precisam de `--env-file .env --env-file .env.local`; para subir, use `pnpm infra:up`. Para ver a configuração final sem expor segredos, use `docker compose --env-file .env --env-file .env.local config --quiet` (só valida).

## Problemas comuns

| Sintoma | Causa e solução |
|---|---|
| `required variable DB_PASSWORD is missing a value: defina DB_PASSWORD em .env.local` | Falta `DB_PASSWORD` (ou está vazio) no `.env.local`. Rode `pnpm keys:generate`. A mesma mensagem existe para `REDIS_PASSWORD`. Nada é criado. |
| `couldn't find env file: .../.env.local` | O `.env.local` não existe. Rode `pnpm keys:generate`. |
| A API não autentica no Postgres depois de `pnpm keys:generate --force` | O Postgres só lê `POSTGRES_PASSWORD` ao criar o volume. Recrie com `down -v` (apaga os dados de dev) ou troque a senha no banco. |
| `port is already allocated` | Outra coisa usa 15432 ou 16379. Mude `POSTGRES_PORT` ou `REDIS_PORT` exportando a variável no shell (tem precedência sobre os arquivos), sem editar o `.env` versionado. |
| Aviso do Redis `Server can't set maximum open files to 10032` | Esperado: com `nofile` 4096 o Redis reduz `maxclients` para 4064, suficiente para dev. |
| Aviso do Redis `Memory overcommit must be enabled` | Esperado e inofensivo aqui: sem persistência o Redis não faz fork para salvar. |
