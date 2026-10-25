# Setup local de desenvolvimento

Fonte: specs/014 §Ambientes (dev: Postgres e Redis via `pnpm infra:up`; API e web com `pnpm dev`), ADR 0010 (Redis) e ADR 0023 (segredos). Variáveis e segredos: [variaveis-de-ambiente.md](variaveis-de-ambiente.md).

## Pré-requisitos

| Ferramenta | Versão | Observação |
|---|---|---|
| Node | 24 LTS, **>= 24.7** | `.nvmrc`; `nvm use` na raiz. A API usa `crypto.argon2`, do Node 24.7 (ADR 0027) |
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

Quem já tinha um `.env.local` de antes desta mudança: rode `pnpm keys:generate` uma vez; ele não altera nenhuma linha do `.env.local` e só cria `.secrets/` com as mesmas senhas, então o volume do Postgres continua válido.

**Depois de cada pull que traga segredos ou migrations novos** (task 042), rode de novo:

```sh
pnpm keys:generate   # acrescenta ao .env.local só o que faltar (hoje: DB_API_PASSWORD), sem --force
pnpm db:migrate      # cria o papel leilao_api e aplica a senha dele (ADR 0026)
```

Sem `POSTGRES_API_USER` (já no `.env`) e `DB_API_PASSWORD`, o `pnpm db:migrate` falha antes de conectar. Para os testes e2e, instale o Chromium do Playwright uma vez, quando a config do Playwright existir: `pnpm exec playwright install chromium` (no CI isso é um passo próprio, com cache).

`pnpm dev` (API em :13000, web em :15173), `pnpm db:migrate` e `pnpm db:seed` dependem das tarefas da fase F0 e F1 e ainda podem ser stubs.

## O que sobe

O `docker-compose.yml` da raiz só inclui o compose de cada sistema. O nome do projeto é `leilao`, fixo no `name:` desse arquivo. O `.env` não define `COMPOSE_PROJECT_NAME`: a variável venceria o `name: leilao-prod` do `infra/docker-compose.prod.yml` e poria o compose de produção no projeto de dev, com os mesmos volumes.

**Worktrees compartilham o projeto.** Como o nome não depende do diretório, todo worktree do git (`.claude/worktrees/*`) cai no mesmo projeto `leilao`, com os mesmos containers e o mesmo volume `leilao_pgdata`. Um `pnpm infra:up` em qualquer worktree reaproveita os containers que já estão no ar, e um `docker compose down -v` em qualquer worktree **apaga o banco de dev de todos**. Para trocar a senha, use `pnpm db:sync-password` (ver [Problemas comuns](#problemas-comuns)), nunca `down -v`.

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
  | Postgres | `CHOWN`, `DAC_READ_SEARCH`, `SETUID`, `SETGID` | dar o PGDATA ao usuário postgres; ler `/run/secrets/db_password` (dono no host, 600) e percorrer o PGDATA, só para leitura (sem `DAC_OVERRIDE`, que também daria escrita; testado na task 023 com init de volume novo, reinício, parada e login por senha); trocar de usuário com `gosu` |
  | Redis | `CHOWN`, `DAC_READ_SEARCH`, `SETUID`, `SETGID` | dar o `redis.conf` ao usuário redis; ler `/run/secrets/redis_password` (só leitura, sem `DAC_OVERRIDE`); trocar de usuário com `setpriv` |

- O entrypoint e o healthcheck dos dois serviços rodam como root, e é por isso que essas capabilities existem. Não acrescente `user:` a nenhum deles sem rever o entrypoint, o healthcheck e o `cap_add`.
- No reinício, o log do Postgres mostra `chmod: /var/lib/postgresql/18/docker: Operation not permitted`. É esperado: o entrypoint tenta pôr 700 no PGDATA, que já está em 700, sem `FOWNER`, e ignora a falha (`|| :`).
- Limite de processos conferido no `docker inspect` (`HostConfig.PidsLimit`, task 023): 200 no Postgres e 64 no Redis, os valores de `POSTGRES_PIDS` e `REDIS_PIDS`.
- No Postgres 18 a imagem grava os dados em `/var/lib/postgresql/18/docker` (`PGDATA`), por isso o volume é montado em `/var/lib/postgresql`, não em `/var/lib/postgresql/data` como até a versão 17.
- O healthcheck do Postgres usa TCP (`pg_isready -h 127.0.0.1`): durante o init o servidor temporário só escuta no socket, então o serviço não fica `healthy` antes do servidor definitivo. `start_period` 60 s com `start_interval` 1 s. Num volume novo o init leva em geral 5 a 10 s; com o disco disputado (fsync lento) já levou ~40 s.
- Nenhuma senha aparece no `Config.Env`, no argv ou no healthcheck do `docker inspect`. O Postgres lê `POSTGRES_PASSWORD_FILE=/run/secrets/db_password`. O entrypoint do Redis valida o charset base64url, grava `requirepass` num `redis.conf` em `/run/redis` (tmpfs, 600, dono `redis`) e o healthcheck usa `REDISCLI_AUTH="$(cat /run/secrets/redis_password)"`.
- O Redis não guarda nada entre reinícios (`save ""`, `appendonly no`, sem volume): cache, rate limit e circuito da Scryfall recomeçam vazios. A imagem `redis:8.8.3-alpine` não declara `VOLUME` (`Config.Volumes` nulo), então também não há volume anônimo.

## Parar e limpar

```sh
docker compose stop      # para, mantém os dados
docker compose down      # remove os containers, mantém o volume
docker compose down -v   # remove também o volume do Postgres: apaga o banco de dev de TODOS os worktrees
docker compose logs -f   # acompanha os logs
```

Esses subcomandos funcionam só com o `.env` (testado com Compose 5.5.1). Para subir, use `pnpm infra:up`. Para validar a configuração, use `docker compose config --quiet`.

Antes da task 002 o Redis tinha um volume `leilao_redisdata`. Ele não é mais usado e o `down -v` não o remove, porque saiu do compose. Apague-o uma vez: `docker volume rm leilao_redisdata`.

## Comandos que expõem segredos

- `docker compose ... config --environment` imprime as variáveis do `.env.local`.
- `docker compose config` sem `--quiet` e `docker inspect` imprimem a configuração completa. Hoje não há senha neles, mas não cole a saída em issue ou log sem conferir.
- `cat .env.local`, `cat .secrets/*` e `docker exec <container> cat /run/secrets/<nome>` mostram o próprio segredo.
- Os backups `.env.bak-*.local` e `.secrets/*.bak-*` que o `pnpm keys:generate --force` deixa também guardam segredos: um conjunto completo de senhas e chaves antigas por execução. Eles se acumulam e nada os apaga sozinho. Depois de conferir que não precisa mais deles (em especial da chave Ed25519 antiga, que verifica os lances já assinados), apague-os: `rm .env.bak-*.local .secrets/*.bak-*`.

## Problemas comuns

| Sintoma | Causa e solução |
|---|---|
| `bind source path does not exist: .../.secrets/db_password` (ou `redis_password`), precedido do aviso `secret file ... does not exist` | Faltam os arquivos de senha. Rode `pnpm keys:generate`; ele os cria a partir do `.env.local`. |
| `couldn't find env file: .../.env.local` | O `.env.local` não existe. Rode `pnpm keys:generate`. |
| Redis reiniciando com `redis: /run/secrets/redis_password vazio ou fora de base64url` | O arquivo foi editado à mão. Apague-o e rode `pnpm keys:generate`, que o recria a partir do `.env.local`. |
| Redis `unhealthy` depois de `pnpm keys:generate --force` | O container ainda usa a senha anterior. `docker compose restart redis` (o `pnpm infra:up` não recria o container quando só o arquivo muda). |
| A API ou o `pnpm db:migrate` falha com `password authentication failed` (código `28P01`), em geral depois de `pnpm keys:generate --force` ou de o volume ter sido criado com um `.secrets/db_password` anterior | **Senha dessincronizada.** O `.env.local` (lido pela API) e `.secrets/db_password` (cópia lida pelo container) têm a senha nova, mas o volume `leilao_pgdata` ainda tem a antiga: o Postgres só lê `POSTGRES_PASSWORD_FILE` quando o volume é criado. Rode `pnpm db:sync-password` (veja a seção abaixo). Não use `down -v`: apaga o banco de dev de todos os worktrees. |
| `pnpm keys:generate` avisa que o `.env.local` ainda define `ED25519_KEY_ID` ou `SEED_DEMO_PASSWORD` | São de antes da ADR 0023. A primeira deixou de existir e a segunda está no `.env`; no `.env.local` elas sobrescrevem o `.env`. Apague as duas linhas do `.env.local`. O script não as remove sozinho, porque sem `--force` nunca altera o conteúdo do arquivo. |
| `pnpm keys:generate` diz `permissão corrigida para 600` (ou `700`) | Um arquivo de segredo ou o `.secrets/` estava aberto demais (por exemplo 644 ou 755, depois de uma cópia ou de um `chmod` à mão). O script fecha o modo e mantém o conteúdo. |
| `db:sync-password` diz que `DB_PASSWORD do .env.local e .secrets/db_password divergem` | Os dois arquivos não têm a mesma senha. Rode `pnpm keys:generate` (sem `--force`) para recopiar o `.env.local` em `.secrets/` e depois `pnpm db:sync-password`. |
| `port is already allocated` | Outra coisa usa 15432 ou 16379. Mude `POSTGRES_PORT` ou `REDIS_PORT` exportando a variável no shell (tem precedência sobre os arquivos), sem editar o `.env` versionado. |
| Aviso do Redis `Server can't set maximum open files to 10032` | Esperado: com `nofile` 4096 o Redis reduz `maxclients` para 4064, suficiente para dev. |
| Aviso do Redis `Memory overcommit must be enabled` | Esperado e inofensivo aqui: sem persistência o Redis não faz fork para salvar. |

## Trocar a senha do Postgres sem apagar o volume (`pnpm db:sync-password`)

Quando usar: logo depois de `pnpm keys:generate --force`, ou sempre que a API der `28P01` com o Postgres de dev no ar. A sequência completa é:

```sh
pnpm keys:generate --force   # novos segredos no .env.local e em .secrets/
pnpm db:sync-password        # aplica a senha nova no volume leilao_pgdata, sem apagar dados
pnpm db:migrate              # aplica a senha nova do papel leilao_api (DB_API_PASSWORD); o sync-password só troca a do dono
docker compose restart redis # o Redis só lê o arquivo novo ao reiniciar
```

O que ele faz (`scripts/db-sync-password.mjs`, task 023):

1. Exige que `DB_PASSWORD` do `.env.local` e `.secrets/db_password` sejam iguais e estejam no formato da ADR 0023. Se divergirem, para sem chamar o Docker.
2. Acha o container do serviço `postgres` do projeto `leilao` (`docker compose ps`). Se ele não estiver no ar, pede `pnpm infra:up`.
3. Confere se a senha já autentica por TCP, no IP do próprio container (o socket e o `127.0.0.1` do container entram sem senha, pelo `pg_hba` da imagem). Se autentica, não altera nada.
4. Senão, roda `ALTER ROLE "<POSTGRES_USER>" PASSWORD '<verificador>'` pelo socket do container (`docker exec -i -u postgres ... psql`), com o SQL no stdin. O verificador SCRAM-SHA-256 é calculado no host, e o Postgres o guarda como veio, então a senha em claro não chega ao servidor. Se o `ALTER ROLE` falhar, o Postgres registra o comando no log dele (`log_min_error_statement = error`), e o que fica no log é o verificador, não a senha. Com ele não se entra no banco, e quebrá-lo por força bruta não é viável com uma senha de 32 bytes aleatórios.
5. Confere de novo por TCP e falha se a senha ainda não autenticar.

A senha nunca vai para o argv (nem do `docker` nem de processos no container), para a saída ou para o log. Na conferência, ela entra pelo stdin e só existe no ambiente do `psql` dentro do container. O `docker` roda sem os 5 segredos no ambiente. De um erro do `psql`, só a linha `ERROR:` chega ao terminal, sem a senha, o verificador ou trechos longos em base64. Rodar de novo é seguro: a segunda execução responde que nada foi alterado. Depois da troca, reinicie a API (`pnpm dev`) se ela estava no ar.
