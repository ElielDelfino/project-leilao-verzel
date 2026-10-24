# Setup local de desenvolvimento

Fonte: specs/014 §Ambientes (dev: Postgres e Redis via `pnpm infra:up`; API e web com `pnpm dev`), ADR 0010 (Redis) e ADR 0015 (segredos). Variáveis e segredos: [variaveis-de-ambiente.md](variaveis-de-ambiente.md).

## Pré-requisitos

| Ferramenta | Versão | Observação |
|---|---|---|
| Node | 24 LTS | `.nvmrc`; `nvm use` na raiz |
| pnpm | 12 | fixado em `packageManager` do `package.json` |
| Docker Engine + Docker Compose | Compose com `include`, `secrets:` de arquivo, `--env-file` repetido e `start_interval` no healthcheck | testado com Docker 29.8.1 e Compose 5.5.1 |

## Passo a passo

```sh
pnpm install          # dependências e git hooks (lefthook)
pnpm keys:generate    # cria .env.local e .secrets/ (600) com os segredos de dev; não regera se já existem
pnpm infra:up         # sobe Postgres e Redis em segundo plano
docker compose ps     # os dois serviços devem aparecer como "healthy" em poucos segundos
```

`pnpm infra:up` é `docker compose --env-file .env --env-file .env.local up -d`. O compose sozinho só lê o `.env` (defaults não sensíveis, versionado); o `.env.local` (fora do Git) é passado explicitamente e, em ordem, sobrescreve o `.env`. As senhas dos containers não vêm do `.env.local`, e sim de `.secrets/db_password` e `.secrets/redis_password` (Compose `secrets:`), que o `pnpm keys:generate` cria e mantém iguais ao `.env.local`.

Quem já tinha um `.env.local` de antes desta mudança: rode `pnpm keys:generate` uma vez; ele não altera o `.env.local` e só cria `.secrets/` com as mesmas senhas, então o volume do Postgres continua válido.

`pnpm dev` (API em :13000, web em :15173), `pnpm db:migrate` e `pnpm db:seed` dependem das tarefas da fase F0 e F1 e ainda podem ser stubs.

## O que sobe

O `docker-compose.yml` da raiz só inclui o compose de cada sistema; o nome do projeto é `leilao` (`COMPOSE_PROJECT_NAME` no `.env`).

| Serviço | Imagem | Porta no host | Dados | Limites (padrão do `.env`) |
|---|---|---|---|---|
| Postgres | `postgres:18.6-alpine` | `127.0.0.1:15432` | volume `leilao_pgdata` em `/var/lib/postgresql` | 1 CPU, 300 MB, 200 processos/threads, `nofile` 4096 |
| Redis | `redis:8.8.3-alpine` | `127.0.0.1:16379` | nenhum: sem persistência (ADR 0010) | 0,5 CPU, 64 MB, `maxmemory 48mb`, 64 processos/threads, `nofile` 4096 |

- As portas só escutam no loopback do host: o banco e o Redis de dev não ficam acessíveis pela rede local. Use `127.0.0.1` (e não `localhost`, que pode resolver para `::1`, onde nada escuta).
- Conexão com o Postgres: `postgres://leilao:<DB_PASSWORD>@127.0.0.1:15432/leilao` (usuário e banco vêm de `POSTGRES_USER` e `POSTGRES_DB`).
- Conexão com o Redis: `127.0.0.1:16379` com a senha `REDIS_PASSWORD`. Sem senha, o Redis responde `NOAUTH`.
- Endurecimento dos dois containers: `read_only: true`; `tmpfs` com tamanho fixo (`/run` 8 MB, `/tmp` 16 MB no Postgres e 8 MB no Redis e, no Postgres, `/var/run/postgresql` 8 MB), todos `nosuid,nodev,noexec`; `cap_drop: ALL`; `no-new-privileges`; limite de processos (`deploy.resources.limits.pids`).
- Capabilities: só o entrypoint, que roda como root, usa as que sobram, e depois troca de usuário. O Postgres e o Redis rodam com uid 70 e 999 e sem nenhuma capability efetiva. Cada uma foi testada removendo-a:

  | Serviço | `cap_add` | Para quê |
  |---|---|---|
  | Postgres | `CHOWN`, `DAC_OVERRIDE`, `SETUID`, `SETGID` | dar o PGDATA ao usuário postgres; ler `/run/secrets/db_password` (dono no host, 600); trocar de usuário com `gosu` |
  | Redis | `CHOWN`, `DAC_READ_SEARCH`, `SETUID`, `SETGID` | dar o `redis.conf` ao usuário redis; ler `/run/secrets/redis_password` (só leitura, sem `DAC_OVERRIDE`); trocar de usuário com `setpriv` |

- No Postgres 18 a imagem grava os dados em `/var/lib/postgresql/18/docker` (`PGDATA`), por isso o volume é montado em `/var/lib/postgresql`, não em `/var/lib/postgresql/data` como até a versão 17.
- O healthcheck do Postgres usa TCP (`pg_isready -h 127.0.0.1`): durante o init o servidor temporário só escuta no socket, então o serviço não fica `healthy` antes do servidor definitivo. `start_period` 60 s com `start_interval` 1 s. Num volume novo o init leva em geral 5 a 10 s; com o disco disputado (fsync lento) já levou ~40 s.
- Nenhuma senha aparece no `Config.Env`, no argv ou no healthcheck do `docker inspect`. O Postgres lê `POSTGRES_PASSWORD_FILE=/run/secrets/db_password`. O entrypoint do Redis valida o charset base64url, grava `requirepass` num `redis.conf` em `/run/redis` (tmpfs, 600, dono `redis`) e o healthcheck usa `REDISCLI_AUTH="$(cat /run/secrets/redis_password)"`.
- O Redis não guarda nada entre reinícios (`save ""`, `appendonly no`, sem volume): cache, rate limit e circuito da Scryfall recomeçam vazios. A imagem `redis:8.8.3-alpine` não declara `VOLUME` (`Config.Volumes` nulo), então também não há volume anônimo.

## Parar e limpar

```sh
docker compose stop      # para, mantém os dados
docker compose down      # remove os containers, mantém o volume
docker compose down -v   # remove também o volume do Postgres (apaga os dados de dev)
docker compose logs -f   # acompanha os logs
```

Esses subcomandos funcionam só com o `.env` (testado com Compose 5.5.1). Para subir, use `pnpm infra:up`. Para validar a configuração, use `docker compose config --quiet`.

Antes da task 002 o Redis tinha um volume `leilao_redisdata`. Ele não é mais usado e o `down -v` não o remove, porque saiu do compose. Apague-o uma vez: `docker volume rm leilao_redisdata`.

## Comandos que expõem segredos

- `docker compose ... config --environment` imprime as variáveis do `.env.local`.
- `docker compose config` sem `--quiet` e `docker inspect` imprimem a configuração completa. Hoje não há senha neles, mas não cole a saída em issue ou log sem conferir.
- `cat .env.local`, `cat .secrets/*` e `docker exec <container> cat /run/secrets/<nome>` mostram o próprio segredo.

## Problemas comuns

| Sintoma | Causa e solução |
|---|---|
| `bind source path does not exist: .../.secrets/db_password` (ou `redis_password`), precedido do aviso `secret file ... does not exist` | Faltam os arquivos de senha. Rode `pnpm keys:generate`; ele os cria a partir do `.env.local`. |
| `couldn't find env file: .../.env.local` | O `.env.local` não existe. Rode `pnpm keys:generate`. |
| Redis reiniciando com `redis: /run/secrets/redis_password vazio ou fora de base64url` | O arquivo foi editado à mão. Apague-o e rode `pnpm keys:generate`, que o recria a partir do `.env.local`. |
| Redis `unhealthy` depois de `pnpm keys:generate --force` | O container ainda usa a senha anterior. `docker compose restart redis` (o `pnpm infra:up` não recria o container quando só o arquivo muda). |
| A API não autentica no Postgres depois de `pnpm keys:generate --force` | O Postgres só lê a senha ao criar o volume. Recrie com `down -v` (apaga os dados de dev) ou troque a senha no banco. |
| `port is already allocated` | Outra coisa usa 15432 ou 16379. Mude `POSTGRES_PORT` ou `REDIS_PORT` exportando a variável no shell (tem precedência sobre os arquivos), sem editar o `.env` versionado. |
| Aviso do Redis `Server can't set maximum open files to 10032` | Esperado: com `nofile` 4096 o Redis reduz `maxclients` para 4064, suficiente para dev. |
| Aviso do Redis `Memory overcommit must be enabled` | Esperado e inofensivo aqui: sem persistência o Redis não faz fork para salvar. |
