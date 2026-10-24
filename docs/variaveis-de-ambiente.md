# Variáveis de ambiente

Fonte: specs/014 §Segredos, specs/008 §Chaves e ADR 0015 (substituição proposta na ADR 0023, pendente de decisão do humano). Este documento lista nomes, formatos e usos; **nunca coloque valores aqui**.

## Onde cada grupo vive

| Grupo | Dev | CI | Produção |
|---|---|---|---|
| Defaults não sensíveis (portas, imagens, limites) | `.env` (versionado) | `.env` | `.env` |
| Segredos | `.env.local` (fora do Git), criado por `pnpm keys:generate` | GitHub Secrets | GCP Secret Manager → um arquivo por segredo em `/run/leilao/secrets/` (tmpfs, 600, dono uid 1000), montado com Compose `secrets:`; a API lê `<VAR>_FILE` |
| Não secretas com valor público (`SEED_DEMO_PASSWORD`) | `.env` | `.env` | `.env` |
| Senhas do Postgres e do Redis para os containers de dev | `.secrets/db_password` e `.secrets/redis_password` (fora do Git), criados por `pnpm keys:generate` a partir do `.env.local` | a definir (tarefa 006) | os arquivos de `/run/leilao/secrets/` (`LEILAO_SECRETS_DIR`) |

A infra local sobe com `pnpm infra:up` (= `docker compose --env-file .env --env-file .env.local up -d`).

Os composes de dev não recebem senha por variável de ambiente: o Postgres e o Redis leem os arquivos de `.secrets/`, montados pelo Compose `secrets:` (bind mount somente leitura em `/run/secrets/<nome>`). Assim nenhuma senha aparece no `Config.Env`, no argv ou no healthcheck do `docker inspect`. Sem o arquivo, o `up` avisa `secret file <projeto>_<nome> does not exist` e falha com `bind source path does not exist: .../.secrets/<nome>`; rode `pnpm keys:generate`. O `docker compose config --quiet` não detecta essa falta (sai 0). Sem o `.env.local`, o `pnpm infra:up` sai com `couldn't find env file: .../.env.local`. (Docker Compose 5.5.1, verificado em 2026-10-24.) O `.env.local` continua com `DB_PASSWORD` e `REDIS_PASSWORD` porque a API, que roda no host em dev, lê as senhas de lá.

## Configuração da API (não sensível)

A API valida estas variáveis com Zod no boot (`apps/api/src/config/env.ts`). Faltando uma obrigatória, ou com valor inválido, ela não sobe, e a mensagem cita só o nome da variável. Em dev, `pnpm dev` passa `.env` e `.env.local` à API com `--env-file` (sem interpolação: `${VAR}` não é expandido).

| Variável | Formato | Default | Valor em dev | Lida desde |
|---|---|---|---|---|
| `API_PORT` | inteiro de 1 a 65535 | nenhum (obrigatória) | `13000` (`.env`) | tarefa 004 |
| `LOG_LEVEL` | `fatal`, `error`, `warn`, `info`, `debug`, `trace` ou `silent` | `info` | ausente (usa o default) | tarefa 004 |

### Conexão com Postgres e Redis (specs/014 §Conexão da API com Postgres e Redis)

A conexão é lida em partes; não existem `DATABASE_URL` nem `REDIS_URL`. Uma URL completa repetiria a senha no `.env.local`, porque o `--env-file` não interpola, e em produção exigiria um sexto segredo ou a senha no `environment:` do compose. Todas são obrigatórias, sem default no código. Usadas pela API e pelo runner de migrations a partir das tarefas 003 e 017.

| Variável | Formato | Valor em dev | Produção |
|---|---|---|---|
| `POSTGRES_HOST` | nome de host ou IP | `127.0.0.1` (a acrescentar no `.env`) | `postgres` (serviço do compose) |
| `POSTGRES_PORT` | inteiro de 1 a 65535 | `15432` (`.env`; é também a porta publicada pelo compose de dev) | `5432` (porta interna), no `environment:` do serviço da API |
| `POSTGRES_DB` | nome do banco | `leilao` (`.env`); os testes usam `leilao_test` | `leilao` |
| `POSTGRES_USER` | nome do usuário | `leilao` (`.env`) | `leilao` |
| `DB_PASSWORD` | ver §Segredos | `.env.local` | Secret Manager, lida por `DB_PASSWORD_FILE=/run/secrets/db_password` |
| `REDIS_HOST` | nome de host ou IP | `127.0.0.1` (a acrescentar no `.env`) | `redis` (serviço do compose) |
| `REDIS_PORT` | inteiro de 1 a 65535 | `16379` (`.env`; também a porta publicada) | `6379` (porta interna) |
| `REDIS_PASSWORD` | ver §Segredos | `.env.local` | Secret Manager, lida por `REDIS_PASSWORD_FILE=/run/secrets/redis_password` |

Em dev, a API roda no host e usa as portas publicadas em `127.0.0.1`; em produção, ela está na rede do compose e usa o nome do serviço e a porta interna.

## Segredos (`.env.local`)

| Variável | Formato gerado | Usado por | Produção |
|---|---|---|---|
| `DB_PASSWORD` | 32 bytes aleatórios, base64url sem padding (43 caracteres); usada como texto | API; Postgres pela cópia em `.secrets/db_password` (`POSTGRES_PASSWORD_FILE`) | Secret Manager → `db_password` |
| `REDIS_PASSWORD` | idem | API; Redis pela cópia em `.secrets/redis_password` (diretiva `requirepass` num `redis.conf` em tmpfs) | Secret Manager → `redis_password` |
| `JWT_SECRET` | 32 bytes aleatórios, base64url sem padding (43 caracteres); a chave HS256 são os 32 bytes decodificados | API: assinatura do access token (specs/003) | Secret Manager → `jwt_secret` |
| `PSEUDONYM_HMAC_KEY` | 32 bytes aleatórios, base64url sem padding (43 caracteres); a chave HMAC são os 32 bytes decodificados | API: pseudônimo HMAC-SHA256 do licitante (specs/008 §Chaves) | Secret Manager → `pseudonym_hmac_key` |
| `ED25519_PRIVATE_KEY` | seed Ed25519 de 32 bytes (RFC 8032 §5.1.5, gerada com `@noble/ed25519`), base64url sem padding (43 caracteres) | API: assinatura dos lances e do selo (specs/008 §Chaves) | Secret Manager → `ed25519_private_key` |

Variáveis que o `pnpm keys:generate` ainda gera e que saem dele com a ADR 0023 (pedido ao infra):

- `ED25519_KEY_ID`: deixa de existir. A API deriva o `keyId` da chave pública: 16 primeiros caracteres hex minúsculos de SHA-256 dos 32 bytes dela (specs/008 §Chaves, com vetor de teste).
- `SEED_DEMO_PASSWORD`: não é segredo. Vai para o `.env` versionado, com o mesmo valor em dev, CI e produção (proposta: `leilao-demo-2026`; 10 a 128 caracteres `A–Z a–z 0–9 - _`, specs/003 RF-03), e é publicada no README. Um `.env.local` antigo que ainda tenha essas linhas sobrescreve o `.env` em dev: apague-as.

Base64url (RFC 4648 §5) usa só `A–Z a–z 0–9 - _`, então nenhum valor precisa de aspas no `.env` nem de escape no compose ou numa URL de conexão. O entrypoint do Redis recusa uma senha fora desse conjunto (uma quebra de linha injetaria diretivas no `redis.conf`) e sai com erro, sem exibir o valor.

A chave pública não é gravada: a API a deriva de `ED25519_PRIVATE_KEY`.

## `<VAR>` ou `<VAR>_FILE` (specs/014 §Segredos)

Para cada um dos 5 segredos, a API, o runner de migrations e o seed leem exatamente uma de `<VAR>` (o valor; dev e CI) ou `<VAR>_FILE` (caminho do arquivo com o valor; produção, `/run/secrets/<nome>`). Não sobem com as duas, sem nenhuma, com arquivo ausente ou ilegível, com valor fora do formato acima ou com quebra de linha no fim do arquivo; a mensagem cita só o nome da variável. Os arquivos de `.secrets/` e de `/run/leilao/secrets/` são gravados sem quebra de linha.

## `pnpm keys:generate`

- Cria `.env.local` na raiz do repositório com permissão 600.
- Cria `.secrets/` (permissão 700) ao lado do `.env.local`, com `db_password` e `redis_password` (permissão 600, só o valor, sem quebra de linha), copiados de `DB_PASSWORD` e `REDIS_PASSWORD`. O `.env.local` é a fonte: os arquivos de `.secrets/` sempre seguem os valores dele.
- Se o `.env.local` já existe, ele não é alterado e o comando sai com código 0. Os arquivos de `.secrets/` são criados se faltarem, mantidos se iguais ao `.env.local` e regravados se diferentes (o anterior vai para backup). Para regerar todos os segredos: `pnpm keys:generate --force`.
- Recusa um `.env.local` existente sem `DB_PASSWORD` ou `REDIS_PASSWORD` em base64url; a mensagem cita o nome da variável, nunca o valor.
- Com `--force`, o `.env.local` anterior é guardado antes da troca em `.env.bak-<data-hora UTC>-<sufixo>.local` (permissão 600, no mesmo diretório), e cada arquivo de `.secrets/` em `.secrets/<nome>.bak-<data-hora UTC>-<sufixo>` (permissão 600). Os nomes casam com `.env.*.local` e `.secrets/` do `.gitignore`. A saída cita os caminhos dos backups, nunca os valores. Os backups não são apagados automaticamente: apague-os quando não precisar mais da chave antiga.
- Nunca imprime valores: a saída lista só nomes de variáveis e caminhos.
- A gravação de cada arquivo é atômica (temporário `.env.tmp-<pid>-<nome>.local` no mesmo diretório + `link`/`rename`): uma falha no meio não deixa arquivo incompleto. O `.env.local` é gravado antes de `.secrets/`; se algo falhar depois dele, rodar `pnpm keys:generate` de novo sincroniza `.secrets/`.
- Recusa, sem gravar nada, um destino que o git versionaria: o alvo, os arquivos de `.secrets/`, os temporários ou os backups dentro de uma working tree sem estar no `.gitignore`, ou um arquivo já rastreado. Também recusa link simbólico (mesmo pendente) no `.env.local`, em `.secrets/` ou nos arquivos dele, diretório no lugar de arquivo e diretório de destino inexistente.
- `--out <caminho>` grava em outro arquivo (e `.secrets/` no mesmo diretório), só fora do repositório ou em caminho ignorado pelo git; existe para os testes (`pnpm test:scripts`).

Ao regerar com `--force`, o Postgres continua com a senha antiga: ele só lê a senha ao inicializar o volume. Recrie o volume local (`docker compose down -v`, apaga os dados de dev) ou troque a senha no banco antes de subir de novo. O Redis lê o arquivo a cada início do container: `docker compose restart redis`. Trocar `ED25519_PRIVATE_KEY` invalida a verificação dos lances já assinados com a chave anterior, a menos que a chave pública antiga continue publicada (ADR 0005, rotação por `key_id`); a chave antiga só fica no backup.

## Saídas que expõem segredos

- `docker compose --env-file .env --env-file .env.local config --environment` imprime todas as variáveis de interpolação, inclusive as do `.env.local`. Não use em terminal compartilhado nem cole a saída em issue ou log.
- `docker compose config` sem `--quiet` imprime o modelo completo; hoje ele não contém senha (elas vêm de arquivo), mas qualquer variável sensível acrescentada no futuro apareceria ali. Para validar, use `config --quiet`.
- `docker inspect` mostra env, argv, mounts e healthcheck do container. Nos composes de dev nenhuma senha aparece ali; não acrescente segredo em `environment:` nem em `command:`.
- `docker exec <container> cat /run/secrets/<nome>` e o `.env.local` mostram o valor: são o próprio segredo.
