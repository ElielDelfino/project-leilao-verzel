# Variáveis de ambiente

Fonte: specs/014 §Segredos, specs/008 §Chaves, ADR 0023 (que substitui a 0015) e ADR 0033 (VPS, sem Secret Manager). Produção: [deploy.md](deploy.md). Este documento lista nomes, formatos e usos; **nunca coloque valores aqui**.

## Onde cada grupo vive

| Grupo | Dev | CI | Produção |
|---|---|---|---|
| Defaults não sensíveis (portas, imagens, limites) | `.env` (versionado) | `.env` | `.env` |
| Segredos | `.env.local` (fora do Git), criado por `pnpm keys:generate` | `.env.local` descartável, gerado no runner por `pnpm keys:generate` | `/opt/leilao/.env.local` na VPS (root, 600, gerado por `infra/deploy/gerar-env-local.sh`; ADR 0033) → um arquivo por segredo em `/run/leilao/secrets/` (tmpfs, 600, dono uid 1000), montado com Compose `secrets:`; a API lê `<VAR>_FILE` |
| Não secretas com valor público (`SEED_DEMO_PASSWORD`) | `.env` | `.env` | `.env` |
| Senhas do Postgres e do Redis para os containers de dev | `.secrets/db_password` e `.secrets/redis_password` (fora do Git), criados por `pnpm keys:generate` a partir do `.env.local` | os mesmos arquivos, gerados no runner por `pnpm keys:generate` (tarefa 006) | `db_password` e `redis_password` no diretório `LEILAO_SECRETS_DIR` do `infra/docker-compose.prod.yml` (padrão `../.secrets`; na VPS, `/run/leilao/secrets/`), montados com Compose `secrets:` em `/run/secrets/<nome>` (tarefa 007) |

A infra local sobe com `pnpm infra:up` (= `docker compose --env-file .env --env-file .env.local up -d`).

Os composes de dev não recebem senha por variável de ambiente: o Postgres e o Redis leem os arquivos de `.secrets/`, montados pelo Compose `secrets:` (bind mount somente leitura em `/run/secrets/<nome>`). Assim nenhuma senha aparece no `Config.Env`, no argv ou no healthcheck do `docker inspect`. Sem o arquivo, o `up` avisa `secret file <projeto>_<nome> does not exist` e falha com `bind source path does not exist: .../.secrets/<nome>`; rode `pnpm keys:generate`. O `docker compose config --quiet` não detecta essa falta (sai 0). Sem o `.env.local`, o `pnpm infra:up` sai com `couldn't find env file: .../.env.local`. (Docker Compose 5.5.1, verificado em 2026-10-24.) O `.env.local` continua com `DB_PASSWORD` e `REDIS_PASSWORD` porque a API, que roda no host em dev, lê as senhas de lá.

## Configuração da API (não sensível)

A API valida estas variáveis com Zod no boot (`apps/api/src/config/env.ts`). Faltando uma obrigatória, ou com valor inválido, ela não sobe, e a mensagem cita só o nome da variável. Em dev, `pnpm dev` passa `.env` e `.env.local` à API com `--env-file` (sem interpolação: `${VAR}` não é expandido).

| Variável | Formato | Default | Valor em dev | Lida desde |
|---|---|---|---|---|
| `API_PORT` | inteiro de 1 a 65535 | nenhum (obrigatória) | `13000` (`.env`) | tarefa 004 |
| `LOG_LEVEL` | `fatal`, `error`, `warn`, `info`, `debug`, `trace` ou `silent` | `info` | ausente (usa o default) | tarefa 004 |
| `SCRYFALL_USER_AGENT` | texto não vazio, `Nome/versão` (header `User-Agent` das chamadas à Scryfall, specs/005) | nenhum (obrigatória) | `LeilaoVerzel/0.1` (`.env`) | F2 (módulo `catalogo`) |
| `SCRYFALL_BASE_URL` | URL absoluta `http(s)://host[:porta]`, sem barra final | `https://api.scryfall.com` | ausente (usa o default) | F2 (módulo `catalogo`) |

`SCRYFALL_BASE_URL` existe só para teste e e2e: aponta a API para uma Scryfall falsa local (specs/005, critérios de aceite). Em dev comum e em produção, não defina. Quando definida, a origem dela (esquema, host e porta) também entra na lista de origens permitidas para baixar a imagem do snapshot, além de `https` e `*.scryfall.io` (specs/005 §Snapshot).

### Conexão com Postgres e Redis (specs/014 §Conexão da API com Postgres e Redis)

A conexão é lida em partes; não existem `DATABASE_URL` nem `REDIS_URL`. Uma URL completa repetiria a senha no `.env.local`, porque o `--env-file` não interpola, e em produção exigiria um sexto segredo ou a senha no `environment:` do compose. Todas são obrigatórias, sem default no código. Usadas pela API e pelo runner de migrations a partir das tarefas 003 e 017.

| Variável | Formato | Valor em dev | Produção |
|---|---|---|---|
| `POSTGRES_HOST` | nome de host ou IP | `127.0.0.1` (a acrescentar no `.env`) | `postgres` (serviço do compose) |
| `POSTGRES_PORT` | inteiro de 1 a 65535 | `15432` (`.env`; é também a porta publicada pelo compose de dev) | `5432` (porta interna), no `environment:` do serviço da API |
| `POSTGRES_DB` | nome do banco | `leilao` (`.env`); os testes usam `leilao_test_<sufixo>`, um banco por worktree (specs/013 §Banco de teste) | `leilao` |
| `POSTGRES_USER` | nome do dono do banco (migrations, seed, Postgres) | `leilao` (`.env`) | `leilao`; a API em produção **não** o recebe (usa `POSTGRES_API_USER`) |
| `POSTGRES_API_USER` | nome do papel da API | `leilao_api` (`.env`; o `db:migrate` exige esse nome) | `leilao_api`, no `environment:` da API (ADR 0026) |
| `DB_PASSWORD` | ver §Segredos; senha do **dono** (`POSTGRES_USER`): `db:migrate`, `db:seed`, `db:sync-password` e os testes; a API **não** a lê | `.env.local` | `/opt/leilao/.env.local` do servidor (ADR 0033), `DB_PASSWORD_FILE=/run/secrets/db_password` só no Postgres e nos one-shots de migrations e seed; a API não a recebe |
| `DB_API_PASSWORD` | ver §Segredos; senha do papel da API | `.env.local` | `/opt/leilao/.env.local` do servidor (ADR 0033), lida por `DB_API_PASSWORD_FILE=/run/secrets/db_api_password` |
| `REDIS_HOST` | nome de host ou IP | `127.0.0.1` (a acrescentar no `.env`) | `redis` (serviço do compose) |
| `REDIS_PORT` | inteiro de 1 a 65535 | `16379` (`.env`; também a porta publicada) | `6379` (porta interna) |
| `REDIS_PASSWORD` | ver §Segredos | `.env.local` | `/opt/leilao/.env.local` do servidor (ADR 0033), lida por `REDIS_PASSWORD_FILE=/run/secrets/redis_password` |

Em dev, a API roda no host e usa as portas publicadas em `127.0.0.1`; em produção, ela está na rede do compose e usa o nome do serviço e a porta interna.

## Segredos (`.env.local`)

| Variável | Formato gerado | Usado por | Produção |
|---|---|---|---|
| `DB_PASSWORD` | 32 bytes aleatórios, base64url canônico sem padding (43 caracteres; recodificar os bytes reproduz o texto); usada como texto | API; Postgres pela cópia em `.secrets/db_password` (`POSTGRES_PASSWORD_FILE`) | `/opt/leilao/.env.local` do servidor → `db_password` |
| `DB_API_PASSWORD` | idem | API (conecta como `leilao_api`, `POSTGRES_API_USER`); `pnpm db:migrate`, que a aplica ao papel com `ALTER ROLE ... PASSWORD '<verificador SCRAM-SHA-256>'` (ADR 0026). Não há cópia em `.secrets/`: o Postgres de dev não a lê | `/opt/leilao/.env.local` do servidor → `db_api_password` |
| `REDIS_PASSWORD` | idem | API; Redis pela cópia em `.secrets/redis_password` (diretiva `requirepass` num `redis.conf` em tmpfs) | `/opt/leilao/.env.local` do servidor → `redis_password` |
| `JWT_SECRET` | 32 bytes aleatórios, base64url sem padding (43 caracteres); a chave HS256 são os 32 bytes decodificados | API: assinatura do access token (specs/003) | `/opt/leilao/.env.local` do servidor → `jwt_secret` |
| `PSEUDONYM_HMAC_KEY` | 32 bytes aleatórios, base64url sem padding (43 caracteres); a chave HMAC são os 32 bytes decodificados | API: pseudônimo HMAC-SHA256 do licitante (specs/008 §Chaves) | `/opt/leilao/.env.local` do servidor → `pseudonym_hmac_key` |
| `ED25519_PRIVATE_KEY` | seed Ed25519 de 32 bytes (RFC 8032 §5.1.5, gerada com `@noble/ed25519`), base64url sem padding (43 caracteres) | API: assinatura dos lances e do selo (specs/008 §Chaves) | `/opt/leilao/.env.local` do servidor → `ed25519_private_key` |

Variáveis que saíram do `pnpm keys:generate` pela ADR 0023 (task 023):

- `ED25519_KEY_ID`: deixou de existir. A API deriva o `keyId` da chave pública: 16 primeiros caracteres hex minúsculos de SHA-256 dos 32 bytes dela (specs/008 §Chaves, com vetor de teste).
- `SEED_DEMO_PASSWORD`: não é segredo. Fica no `.env` versionado, com o mesmo valor em dev, CI e produção (`leilao-demo-2026`, decidido na ADR 0023; 10 a 128 caracteres `A–Z a–z 0–9 - _`, specs/003 RF-03), e é publicada no README. O gitleaks 8.30.1 não aponta essa linha (conferido na task 023), então não há allowlist.
- Um `.env.local` antigo que ainda tenha essas linhas sobrescreve o `.env` em dev. O `pnpm keys:generate` avisa pelo nome, sem mostrar o valor e sem alterar o arquivo: apague as linhas à mão.

Base64url (RFC 4648 §5) usa só `A–Z a–z 0–9 - _`, então nenhum valor precisa de aspas no `.env` nem de escape no compose ou numa URL de conexão. O entrypoint do Redis recusa uma senha fora desse conjunto (uma quebra de linha injetaria diretivas no `redis.conf`) e sai com erro, sem exibir o valor.

A chave pública não é gravada: a API a deriva de `ED25519_PRIVATE_KEY`.

## `<VAR>` ou `<VAR>_FILE` (specs/014 §Segredos)

Para cada um dos 6 segredos que o processo usa, a API, o runner de migrations e o seed leem exatamente uma de `<VAR>` (o valor; dev e CI) ou `<VAR>_FILE` (caminho do arquivo com o valor; produção, `/run/secrets/<nome>`). Não sobem com as duas, sem nenhuma, com arquivo ausente ou ilegível, com valor fora do formato acima ou com quebra de linha no fim do arquivo; a mensagem cita só o nome da variável. Os arquivos de `.secrets/` e de `/run/leilao/secrets/` são gravados sem quebra de linha.

## `pnpm keys:generate`

- Cria `.env.local` na raiz do repositório com permissão 600.
- Cria `.secrets/` (permissão 700) ao lado do `.env.local`, com `db_password` e `redis_password` (permissão 600, só o valor, sem quebra de linha), copiados de `DB_PASSWORD` e `REDIS_PASSWORD`. O `.env.local` é a fonte: os arquivos de `.secrets/` sempre seguem os valores dele.
- Se o `.env.local` já existe, nenhuma linha dele é alterada e o comando sai com código 0. Se faltar alguma variável de `VARIAVEIS` (por exemplo `DB_API_PASSWORD`, num arquivo anterior à task 042), o comando **acrescenta só as que faltam**, no fim, sem `--force`, com valores novos e sem trocar nenhuma das outras (as linhas existentes ficam byte a byte como estavam; o arquivo continua 600), e avisa os nomes acrescentados. Depois disso, rode `pnpm db:migrate` para aplicar a senha nova ao papel `leilao_api`. Os arquivos de `.secrets/` são criados se faltarem, mantidos se iguais ao `.env.local` e regravados se diferentes (o anterior vai para backup). Para regerar todos os segredos: `pnpm keys:generate --force`.
- Permissões que já existiam são corrigidas, nunca aceitas: um `.env.local` ou arquivo de `.secrets/` mantido com outro modo (por exemplo 644) volta a 600, e um `.secrets/` existente (por exemplo 755) volta a 700. A saída diz `permissão corrigida para 600` (ou `700`). A troca de modo abre o caminho com `O_NOFOLLOW`, então um link simbólico colocado no lugar é recusado.
- Dono dos arquivos: o do usuário que roda o comando. O Compose ignora `uid`, `gid` e `mode` de secrets com `file:` (ADR 0023), então só o uid 1000 (usuário `node` da imagem da API) consegue ler `.secrets/` pelo `infra/docker-compose.prod.yml` local. Com outro uid, o comando avisa. Em dev isso não importa: a API roda no host e lê o `.env.local`.
- Recusa um `.env.local` existente sem `DB_PASSWORD` ou `REDIS_PASSWORD` em base64url; a mensagem cita o nome da variável, nunca o valor.
- Com `--force`, o `.env.local` anterior é guardado antes da troca em `.env.bak-<data-hora UTC>-<sufixo>.local` (permissão 600, no mesmo diretório), e cada arquivo de `.secrets/` em `.secrets/<nome>.bak-<data-hora UTC>-<sufixo>` (permissão 600). Os nomes casam com `.env.*.local` e `.secrets/` do `.gitignore`. A saída cita os caminhos dos backups, nunca os valores. Os backups não são apagados automaticamente e se acumulam a cada `--force`, cada um com senhas e chaves antigas: confira que não precisa mais deles (em especial da chave Ed25519 antiga) e apague-os (`rm .env.bak-*.local .secrets/*.bak-*`).
- Nunca imprime valores: a saída lista só nomes de variáveis e caminhos.
- A gravação de cada arquivo é atômica (temporário `.env.tmp-<pid>-<nome>.local` no mesmo diretório + `link`/`rename`): uma falha no meio não deixa arquivo incompleto. O `.env.local` é gravado antes de `.secrets/`; se algo falhar depois dele, rodar `pnpm keys:generate` de novo sincroniza `.secrets/`.
- Recusa, sem gravar nada, um destino que o git versionaria: o alvo, os arquivos de `.secrets/`, os temporários ou os backups dentro de uma working tree sem estar no `.gitignore`, ou um arquivo já rastreado. Também recusa link simbólico (mesmo pendente) no `.env.local`, em `.secrets/` ou nos arquivos dele, diretório no lugar de arquivo e diretório de destino inexistente.
- `--out <caminho>` grava em outro arquivo (e `.secrets/` no mesmo diretório), só fora do repositório ou em caminho ignorado pelo git; existe para os testes (`pnpm test:scripts`).

Ao regerar com `--force`, o Postgres continua com a senha antiga: ele só lê a senha ao inicializar o volume. Rode `pnpm db:sync-password`: ele aplica a senha nova **do dono** (`DB_PASSWORD`) no volume existente, sem apagar dados; a do papel da API (`DB_API_PASSWORD`) é aplicada pelo `pnpm db:migrate`, que também roda depois do `--force` (ver [dev-setup.md](dev-setup.md#problemas-comuns)). Não use `docker compose down -v`, que apaga o volume compartilhado por todos os worktrees. O Redis lê o arquivo a cada início do container: `docker compose restart redis`. Trocar `ED25519_PRIVATE_KEY` invalida a verificação dos lances já assinados com a chave anterior, a menos que a chave pública antiga continue publicada (ADR 0005, rotação por `key_id`); a chave antiga só fica no backup.

## Saídas que expõem segredos

- `docker compose --env-file .env --env-file .env.local config --environment` imprime todas as variáveis de interpolação, inclusive as do `.env.local`. Não use em terminal compartilhado nem cole a saída em issue ou log.
- `docker compose config` sem `--quiet` imprime o modelo completo; hoje ele não contém senha (elas vêm de arquivo), mas qualquer variável sensível acrescentada no futuro apareceria ali. Para validar, use `config --quiet`.
- `docker inspect` mostra env, argv, mounts e healthcheck do container. Nos composes de dev nenhuma senha aparece ali; não acrescente segredo em `environment:` nem em `command:`.
- `docker exec <container> cat /run/secrets/<nome>` e o `.env.local` mostram o valor: são o próprio segredo.
