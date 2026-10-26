# 014 — Deploy e operação

Status: aprovada
Depende de: 001, 013

## Ambientes (ADR 0033)
| Ambiente | Onde | Observação |
|---|---|---|
| dev | máquina local | Postgres e Redis via `pnpm infra:up`; API e web com `pnpm dev` |
| prod | VPS Hostinger: 1 vCPU, 4 GB de RAM, 50 GB NVMe, Ubuntu 24.04 LTS | compose de produção + Caddy, em `https://<subdominio>.duckdns.org` |

Sem staging: a paridade vem do compose. `<host>` nesta spec é `<subdominio>.duckdns.org`; o nome ainda vai ser definido pelo humano.

## Servidor (ADR 0033, itens 1 e 3)
- Ubuntu 24.04 LTS limpo, **sem painel** (nada de Coolify, Dokploy, CloudPanel, HestiaCP ou similar). Docker Engine e o plugin Docker Compose do repositório apt oficial da Docker. Swap de 2 GB em arquivo.
- Usuários:
  - um administrador não-root com sudo, criado pelo humano, que é o dono do uid 1000 no host (§Segredos);
  - `deploy`, sem sudo, no grupo `docker`, usado só pela chave de deploy (§CI/CD).
  - Nenhum outro usuário faz login.
- SSH só por chave. Valores **efetivos** de `sshd -T`: `permitrootlogin no`, `passwordauthentication no`, `kbdinteractiveauthentication no` e `allowusers` com os dois usuários. A configuração entra num arquivo de `/etc/ssh/sshd_config.d/` lido antes dos outros (o primeiro valor vence; a imagem pode trazer um arquivo que liga a senha).
- UFW: entrada negada por padrão; liberadas só 22/tcp (com `limit`), 80/tcp e 443/tcp, em IPv4 e IPv6.
- Só o Caddy publica portas (80 e 443 TCP). Postgres e Redis ficam na rede `dados` (`internal: true`), sem `ports:`. Porta publicada pelo Docker passa por fora do UFW, então um `ports:` em qualquer outro serviço é defeito.
- `unattended-upgrades` ligado só com as atualizações de segurança, **sem reinício automático**. Quando `/var/run/reboot-required` existir, o humano reinicia fora de leilão ao vivo, e o critério de reboot garante a volta.
- Logs do journald limitados a 500 MB (`SystemMaxUse`).

## Produção
- Host: `<subdominio>.duckdns.org`. O registro A aponta para o IP público fixo da VPS e é configurado uma vez pelo humano no site do DuckDNS. Não há atualizador de IP, e o token do DuckDNS não vai para a VPS nem para o GitHub.
- TLS: o Caddy emite e renova o certificado Let's Encrypt sozinho (HTTP-01 na porta 80). HTTP responde com redirecionamento para HTTPS. HTTPS é obrigatório: os cookies `Secure` (specs/003), o CSRF, o `wss` do Socket.IO e a API de clipboard do comprovante dependem dele. O volume `caddy_data` (conta ACME e certificados) persiste e não é recriado à toa, por causa do limite de 5 certificados idênticos por semana do Let's Encrypt.
- `infra/docker-compose.prod.yml` inclui Postgres, Redis, API e Caddy, com `read_only`, `tmpfs /run`, `ulimits` e portas internas. Os valores de produção vêm de `infra/prod.env` (versionado, sem segredo, lido depois do `.env`, que guarda os defaults de dev). As migrations e o seed são serviços one-shot do mesmo compose, com a imagem da API, que só rodam quando chamados (`profiles`).
- Limites de memória (ADR 0033, item 8):

  | Serviço | RAM (`deploy.resources.limits.memory`) | RAM + swap (`memswap_limit`) | Outros |
  |---|---|---|---|
  | Postgres | 1 GB | 2 GB | |
  | API | 768 MB | 1,5 GB | `--max-old-space-size=576` (75% do limite) |
  | Redis | 128 MB | 128 MB (sem swap) | `maxmemory` 96 MB, `volatile-lru`, sem persistência |
  | Caddy | 128 MB | 128 MB (sem swap) | `GOMEMLIMIT` 96 MiB |

  A soma é de 2 GB, e sobram cerca de 1,8 GB para o sistema, o Docker, o one-shot, o `pg_dump` e o cache de páginas. Só Postgres e API têm swap, de 2× o limite (ADR 0024, item 2). Os limites de CPU são Postgres 1, API 1, Redis 0,5 e Caddy 0,5: tetos, não reservas.
- Caddy: serve a SPA (`apps/web/dist`, copiada para a imagem do Caddy), faz o proxy de `/api/*` e `/socket.io/*` para a API e manda os headers de segurança. A CSP tem `img-src 'self' data: https://cards.scryfall.io` (ADR 0029, que complementa a 0024), e há HSTS, nosniff e frame-ancestors none. Só HTTP/1.1 e HTTP/2: o HTTP/3 fica desligado e o 443/udp não é publicado (ADR 0024).
- **Nunca rodam na VPS:**
  - build de imagem;
  - o k6 (specs/013), que roda de fora;
  - `pnpm demo:adulterar` (specs/008). A VPS não tem Node nem o repositório, e o script recusa `NODE_ENV=production`. O README avisa.

## Segredos (ADR 0023, ADR 0026, ADR 0033)
- São seis: `DB_PASSWORD`, `DB_API_PASSWORD`, `REDIS_PASSWORD`, `JWT_SECRET`, `ED25519_PRIVATE_KEY` e `PSEUDONYM_HMAC_KEY`. Não há Secret Manager, e nenhum segredo da aplicação vai para o GitHub.
- A API valida o env com Zod no boot e falha rápido.

### Origem e formato de cada variável
| Variável | Formato | dev | CI | prod | Spec que a usa |
|---|---|---|---|---|---|
| `DB_PASSWORD` | 32 bytes aleatórios em base64url canônico sem padding (43 caracteres `A–Z a–z 0–9 - _`, ver §Leitura); usada como texto | `.env.local` e cópia em `.secrets/db_password` | gerada no runner por `pnpm keys:generate` (descartável) | `/opt/leilao/.env.local` → arquivo | §Conexão |
| `DB_API_PASSWORD` | idem; senha do papel `leilao_api` (§Papéis do Postgres); usada como texto | `.env.local` | idem | `/opt/leilao/.env.local` → arquivo `db_api_password` | §Conexão |
| `REDIS_PASSWORD` | idem | `.env.local` e cópia em `.secrets/redis_password` | idem | `/opt/leilao/.env.local` → arquivo | §Conexão |
| `JWT_SECRET` | 32 bytes aleatórios em base64url sem padding (43 caracteres); a chave HS256 são os 32 bytes decodificados | `.env.local` | idem | `/opt/leilao/.env.local` → arquivo | specs/003 §Comportamento |
| `PSEUDONYM_HMAC_KEY` | idem; a chave HMAC-SHA256 são os 32 bytes decodificados | `.env.local` | idem | `/opt/leilao/.env.local` → arquivo | specs/008 §Chaves |
| `ED25519_PRIVATE_KEY` | seed Ed25519 de 32 bytes (RFC 8032 §5.1.5) em base64url sem padding (43 caracteres) | `.env.local` | idem | `/opt/leilao/.env.local` → arquivo | specs/008 §Chaves |
| `SEED_DEMO_PASSWORD` | não é segredo: 10 a 128 caracteres `A–Z a–z 0–9 - _`; valor `leilao-demo-2026` | `.env` versionado | `.env` | `.env` | specs/003 RF-03 |

- Não existe `ED25519_KEY_ID`: a API deriva o `keyId` da chave pública (specs/008 §Chaves).
- Todo `.env.local` e todo arquivo de segredo tem permissão 600; nenhum valor tem quebra de linha.
- O `.env` e o `infra/prod.env` versionados não contêm nenhum dos 6 segredos.

### Leitura pela API, pelo runner de migrations e pelo seed
- Para cada um dos 6 segredos que o processo usa (§Conexão diz quais), o processo lê **exatamente uma** de `<VAR>` (o valor; dev e CI) ou `<VAR>_FILE` (caminho absoluto do arquivo com o valor; prod).
- O processo não sobe quando:
  - as duas estão definidas, ou nenhuma está;
  - o arquivo não existe ou não pode ser lido;
  - o valor (da variável ou do arquivo) não está na forma canônica.
- Forma canônica, igual para os 6: exatamente 43 caracteres `A–Z a–z 0–9 - _` que decodificam para 32 bytes, e recodificar esses bytes em base64url sem padding reproduz exatamente o mesmo texto. Isso recusa, por exemplo, um último caractere com bits extras. Uma quebra de linha no fim do arquivo também é recusada.
- A mensagem de erro cita só o nome da variável (`<VAR>` ou `<VAR>_FILE`), nunca o valor nem o conteúdo do arquivo.

### Produção
- **Fonte única no servidor:** `/opt/leilao/.env.local`, dono root, modo 600, fora do Git, com as 6 linhas `<VAR>=<valor>`.
- **Geração:** o humano roda `infra/deploy/gerar-env-local.sh` uma vez, na própria VPS. É o equivalente em shell do `pnpm keys:generate`, porque a VPS não tem Node:
  - cada valor são 32 bytes de `/dev/urandom` em base64url sem padding;
  - nenhum valor passa por argv nem é impresso;
  - o script sai com código 1, sem alterar nada, se o arquivo já existir.
- **Materialização:** `infra/deploy/materializar-segredos.sh` lê o `.env.local` e grava um arquivo por segredo em `/run/leilao/secrets/` (tmpfs; diretório 700; arquivos 600 com dono uid 1000, o usuário `node` da imagem da API; sem quebra de linha): `db_password`, `db_api_password`, `redis_password`, `jwt_secret`, `pseudonym_hmac_key` e `ed25519_private_key`.
  - Ele roda no boot por uma unidade systemd ordenada antes do `docker.service`, porque o tmpfs se perde no reinício.
  - Também roda à mão depois de uma rotação.
  - Sai com código 1, citando só o nome, se faltar uma das 6 variáveis ou se uma delas estiver fora da forma canônica de §Leitura.
  - Imprime só nomes.
- **Montagem:** `infra/docker-compose.prod.yml` monta esses arquivos com Compose `secrets:` em `/run/secrets/<nome>`, a partir de `LEILAO_SECRETS_DIR=/run/leilao/secrets` no host. Cada serviço recebe só os `<VAR>_FILE=/run/secrets/<nome>` de que precisa:
  - a API: `DB_API_PASSWORD_FILE`, `REDIS_PASSWORD_FILE`, `JWT_SECRET_FILE`, `ED25519_PRIVATE_KEY_FILE` e `PSEUDONYM_HMAC_KEY_FILE`. **Nunca** `DB_PASSWORD_FILE` nem o secret `db_password` montado.
  - o one-shot de migrations: `DB_PASSWORD_FILE` e `DB_API_PASSWORD_FILE`;
  - o one-shot de seed: `DB_PASSWORD_FILE` e os segredos que as etapas do seed usam;
  - o Postgres lê `POSTGRES_PASSWORD_FILE` e o Redis lê o arquivo no entrypoint, como em dev.
- Nenhum segredo vai em `environment:`, `env_file:`, `command:`, healthcheck ou argumento de build. O `/opt/leilao/.env.local` nunca é passado ao Compose (nem por `--env-file`) e só é lido pelo script de materialização.
- O Compose ignora `uid`, `gid` e `mode` de secrets com `file:` fora do Swarm (monta o arquivo do host em bind somente leitura), então dono e modo vêm do script de materialização. No host, o uid 1000 é do administrador e nunca do `deploy`.
- Sem um arquivo, o `up` do serviço que o usa falha (`bind source path does not exist: <caminho>`) e o deploy aborta (specs/001).
- **Rotação:** é manual. O humano troca a linha no `.env.local`, roda a materialização e recria os serviços afetados. Valem as consequências da ADR 0023:
  - `JWT_SECRET` invalida os access tokens em circulação;
  - `PSEUDONYM_HMAC_KEY` não pode ser trocada com lote aberto (ADR 0031);
  - `ED25519_PRIVATE_KEY` mantém as chaves antigas em `signing_keys`;
  - `DB_PASSWORD` e `DB_API_PASSWORD` exigem aplicar a senha nova ao papel (`db:migrate` para o da API).

### Verificação de vazamento
Um passo do deploy, depois do health check, confere que nenhum segredo aparece nas saídas do Docker, sem nunca exibir o valor:
- Para cada arquivo `/run/leilao/secrets/<nome>`, o valor é usado só como padrão de `grep -qF -f /run/leilao/secrets/<nome>` (o valor não entra no argv do `grep`). O `grep` é aplicado à saída de:
  1. `docker inspect` de todos os containers do projeto (`docker compose -p leilao-prod ps -aq`);
  2. `docker compose config` com os mesmos `-p`, `--env-file` e `-f` do deploy (modelo completo, sem `--quiet`);
  3. `docker history --no-trunc` das imagens da API e da web;
  4. `ps -eww -o args=` no host, que inclui o argv de todos os processos dos containers;
  5. `journalctl -u` da unidade de materialização.
- Nenhuma dessas saídas vai para o terminal, para arquivo ou para o log: elas só passam pelo pipe até o `grep -q`. O passo não usa `set -x` nem ecoa variáveis.
- O passo relata só o nome do segredo e da fonte (por exemplo, `jwt_secret: docker inspect`) e sai com código 1 se houver qualquer ocorrência. O deploy então falha e volta para a versão anterior, como no health check falho (§CI/CD). Sem ocorrência, relata só `nenhum segredo nas saídas do Docker`.

### Dev
- `pnpm keys:generate` cria o `.env.local` (os 6 segredos) e os arquivos `.secrets/db_password` e `.secrets/redis_password` (cópias para os containers). Os composes de dev montam só esses dois arquivos com Compose `secrets:`; a API roda no host e lê os valores do `.env.local`.
- Sem `.env.local`, `pnpm infra:up` sai com código 1 e `couldn't find env file: <caminho>/.env.local`.
- Sem um arquivo de `.secrets/`, `pnpm infra:up` falha no serviço que o usa:
  - aviso: `secret file <projeto>_<nome> does not exist`;
  - erro: `bind source path does not exist: <caminho>/.secrets/<nome>`.
  - `docker compose config --quiet` não detecta essa falta (sai 0).
- Mensagens verificadas no Docker Compose 5.5.1 em 2026-10-24; em outra versão, o critério é o `up` falhar citando o caminho do arquivo ausente.

## Conexão da API com Postgres e Redis
A API, o runner de migrations (`pnpm db:migrate`) e o seed (`pnpm db:seed`) leem a conexão em partes, com os mesmos nomes dos segredos de ADR 0023 e dos defaults do `.env`. Não existem `DATABASE_URL` nem `REDIS_URL`. Há dois papéis no Postgres (ADR 0026, §Papéis do Postgres): o **dono** (`leilao`) migra e semeia; a **API** conecta como `leilao_api`, sem superusuário.

| Destino | Variáveis (todas obrigatórias) | dev (API no host) | prod (API no compose) |
|---|---|---|---|
| Postgres, endereço (API, migrations e seed) | `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB` | `127.0.0.1`, `15432`, `leilao` (`.env`) | `postgres`, `5432` (nome do serviço e porta interna) no `environment:` do serviço |
| Postgres, papel da **API** | `POSTGRES_API_USER`, `DB_API_PASSWORD` | `leilao_api` (`.env`); senha no `.env.local` | `leilao_api`; senha por `DB_API_PASSWORD_FILE=/run/secrets/db_api_password` (§Segredos) |
| Postgres, **dono** (`db:migrate` e `db:seed`) | `POSTGRES_USER`, `DB_PASSWORD` | `leilao` (`.env`); senha no `.env.local` | `leilao`; senha por `DB_PASSWORD_FILE=/run/secrets/db_password`, só nos containers one-shot |
| Redis | `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` | `127.0.0.1`, `16379` (`.env`); senha no `.env.local` | `redis`, `6379`, da mesma forma; senha por `REDIS_PASSWORD_FILE=/run/secrets/redis_password` |

- Variáveis exigidas por processo:
  - a API: as dos grupos que lhe cabem (endereço, papel da API e Redis). Ela **não** lê `POSTGRES_USER` nem `DB_PASSWORD` e, em produção, não os recebe;
  - o `db:migrate`: o endereço, o dono e também `POSTGRES_API_USER` e `DB_API_PASSWORD`, porque aplica a senha do papel da API (ADR 0026);
  - o `db:seed`: o endereço e o dono.
- Por que a conexão é em partes:
  - o `--env-file` do Node não interpola variáveis, então uma URL completa repetiria a senha no `.env.local` (duas fontes para o mesmo segredo);
  - em produção, a URL teria de ser montada no `environment:` do compose, onde a senha aparece no `docker inspect`.
- Os testes trocam só o banco: `POSTGRES_DB=leilao_test_<sufixo>` (um por worktree) no banco local, ou host e porta do container com Testcontainers (specs/013 §Banco de teste). Os testes de integração da API conectam como dono, passando as credenciais do dono nos nomes de variáveis da API (specs/013 §Papéis do Postgres nos testes).
- Nenhuma dessas variáveis tem default no código. Faltando qualquer uma das que o processo exige (para as senhas, `<VAR>` ou `<VAR>_FILE`, §Segredos), ele não sobe, e a mensagem cita só o nome da variável, nunca o valor.
- `WEB_ORIGIN` é obrigatória no boot da API e decide o atributo `Secure` dos cookies (specs/003 §Cookies, ADR 0027). No `.env` ela vale `http://localhost:15173`; em produção, `https://<host>` no `environment:` da API.

## Papéis do Postgres (ADR 0026)
- O papel `leilao_api` é criado pela migration, só se ainda não existir (papéis são do cluster):
  - atributos `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT`, sem ser dono de objeto algum;
  - o `db:migrate` exige `POSTGRES_API_USER=leilao_api`;
  - a senha é aplicada com `ALTER ROLE ... PASSWORD '<verificador SCRAM-SHA-256>'`, calculado no cliente: a senha em texto não chega ao servidor, ao argv nem ao log.
- Privilégios por tabela, concedidos pela migration que cria a tabela, sem `ALTER DEFAULT PRIVILEGES`:

  | Tabela | SELECT | INSERT | UPDATE | DELETE |
  |---|---|---|---|---|
  | `users` | sim | sim | não | não |
  | `refresh_tokens` | sim | sim | sim | sim |
  | `wallet_balances` | sim | sim | sim | não |
  | `ledger_entries` | sim | sim | não | não |
  | `bids`, `lot_seals` (F3) | sim | sim | não | não |

  Nenhuma tabela concede `TRUNCATE`, `TRIGGER` nem `REFERENCES`. Tabelas de fases futuras entram nesta matriz na spec do módulo; uma tabela append-only só recebe SELECT e INSERT.
- `pnpm demo:adulterar` (specs/008) conecta como dono.

## CI/CD (ADR 0017, ADR 0033)
- **PR:** `verify:full --e2e`, k6 smoke, `pnpm audit --audit-level high` e gitleaks; CodeQL e Dependabot habilitados no repositório. O CI usa segredos descartáveis, gerados no runner a cada execução por `pnpm keys:generate`.
- **main:** o deploy só roda depois do CI verde do mesmo commit, nunca em pull request, com `concurrency` sem cancelamento:
  1. Build das imagens só no GitHub Actions (`linux/amd64`), nunca na VPS. Push no GHCR como `ghcr.io/<owner>/leilao-api:<sha>` e `leilao-web:<sha>`.
  2. SSH para `deploy@<host>` com a chave de deploy. A chave de host da VPS fica fixada (`known_hosts` vindo do GitHub; nunca `StrictHostKeyChecking=no`).
  3. Na VPS, `deploy <sha>`:
     - confere que existem os 6 arquivos de `/run/leilao/secrets/`;
     - roda `docker compose pull`;
     - roda as migrations no one-shot;
     - roda `docker compose up -d --no-build`;
     - faz o health check de `https://<host>/api/health/ready` por até 60 s, exigindo 200, e confere que `https://<host>/` responde 200;
     - roda a §Verificação de vazamento;
     - remove as imagens antigas, mantendo a atual e a anterior.
  4. Se o health check ou a verificação falhar, `deploy-ssh` volta para as tags anteriores, faz `up -d` e o job falha. No primeiro deploy, sem versão anterior, o job só falha.
- **Comando forçado:** no `authorized_keys` do `deploy`, a chave de deploy tem `restrict` e `command="/opt/leilao/bin/deploy-ssh"`. O `deploy-ssh` lê `SSH_ORIGINAL_COMMAND` e aceita só `deploy <sha>` (40 caracteres hex) e `rollback` (ADR 0034, item 3); qualquer outro comando (inclusive `backup` e uma sessão sem comando) sai com código 1 sem executar nada. O `deploy-ssh` e os scripts que ele chama pertencem ao root e o `deploy` não pode alterá-los.
- O rollback não desfaz migrations: toda migration tem de funcionar com a imagem anterior (só aditiva). Uma migration que remove ou altera coluna escala para o humano (specs/002).
- **GitHub:**
  - secrets `VPS_SSH_KEY` (chave privada ed25519 de deploy) e `VPS_KNOWN_HOSTS`;
  - variável `VPS_HOST` (o nome DuckDNS);
  - ficam no Environment `production` se o plano do repositório oferecer environments; senão, no nível do repositório;
  - actions fixadas por SHA, `permissions` mínimas (`packages: write` só no job de build) e sem `pull_request_target`.
- **GHCR (provisório, ADR 0033 item 5.6):** pacotes públicos, sem credencial do registry na VPS. Se ficarem privados, o job passa à VPS o próprio `GITHUB_TOKEN`, efêmero, por stdin (`docker login --password-stdin`) e faz `docker logout` no fim. Nunca um token pessoal na VPS.
- Tags SemVer (`v0.x`, e `v1.0.0` na entrega) geram release no GitHub com o trecho do CHANGELOG.

## Observabilidade (ADR 0018, ADR 0034)
- Logs Pino em JSON com `requestId`; sem PII (e-mail mascarado).
- `GET /api/health/live` (processo, sem consultar dependências) e `GET /api/health/ready` (Postgres + Redis), ambos públicos. Com sucesso, os dois respondem 200 `{ "sucesso": true, "dados": { "status": "ok" } }`, sem outros campos.
- No `/ready`, cada verificação tem 2 s para responder. Com uma dependência fora, ou sem verificações registradas, responde 503 `INDISPONIVEL` com mensagem fixa e sem `detalhes`: a resposta não diz qual dependência caiu. O nome da dependência e o motivo vão só para o log (warn), sem host nem senha.
- Logs do Docker com `json-file`, `max-size=10m`, `max-file=5` e expurgo de 14 dias.
- Uptime: **fora do escopo da entrega** (ADR 0034); opcional depois, com o monitor gratuito do UptimeRobot em `https://<host>/api/health/ready` (ADR 0033, item 7).
- Sem alerta de orçamento: o único custo é o preço fixo da VPS.

## Backup (ADR 0034)
- **Na entrega, só um `pg_dump` manual.** Antes da entrega, o administrador roda uma vez `pg_dump -Fc` do banco `leilao`:
  - pelo socket local do container (`docker compose exec -T postgres`), sem senha no argv nem no ambiente;
  - com o dump gravado na VPS fora dos volumes do Docker, com modo 600.
  Copiá-lo para fora da VPS é opcional.
- O runbook (`docs/operacao.md`) traz:
  - o comando completo, com os mesmos `-p` e `-f` do deploy;
  - o caminho e o nome do arquivo, com a data em UTC;
  - como conferir o dump com `pg_restore --list`.
- **Fora do escopo da entrega, opcionais depois** (ADR 0034, que substitui nesses pontos a ADR 0033, item 6, e a ADR 0018):
  - cron diário de `pg_dump` com 7 cópias;
  - cópia fora da VPS cifrada com `age` (o comando `backup` do `deploy-ssh` não existe);
  - teste de restauração no CI e restauração real documentada no runbook.

## Critérios de aceite
- [ ] Push na main publica a nova versão em até 10 min depois do CI verde, sem intervenção, e `docker compose images` na VPS mostra `ghcr.io/<owner>/leilao-api:<sha>` e `leilao-web:<sha>` do commit.
- [ ] Health check falho reverte para a versão anterior: um deploy com `/api/health/ready` quebrado de propósito volta às tags anteriores, o `/ready` responde 200 de novo e o job falha.
- [ ] Nenhum serviço pago por uso: os únicos serviços externos são a VPS Hostinger (preço fixo), DuckDNS, Let's Encrypt e GitHub (Actions e GHCR), listados no runbook (ADR 0034, item 4).
- [ ] `sshd -T` na VPS mostra `permitrootlogin no`, `passwordauthentication no` e `kbdinteractiveauthentication no`; um `ssh root@<host>` e um login por senha são recusados.
- [ ] `ufw status verbose` mostra `deny (incoming)` e só 22/tcp (LIMIT), 80/tcp e 443/tcp liberadas, em v4 e v6. Uma varredura TCP de 1 a 65535 feita de fora da VPS acha só 22, 80 e 443 abertas, e `docker compose ps` mostra portas publicadas só no Caddy.
- [ ] `http://<host>/` redireciona para `https://<host>/`; o certificado é do Let's Encrypt, válido para `<host>`; a resposta tem `Strict-Transport-Security`.
- [ ] `unattended-upgrades` habilitado, com `APT::Periodic::Unattended-Upgrade "1"` e sem `Unattended-Upgrade::Automatic-Reboot "true"`.
- [ ] A chave de deploy não abre shell: `ssh deploy@<host>` sem comando, `id`, `backup` e `deploy` com sha inválido saem com código ≠ 0 sem executar nada.
- [ ] `gerar-env-local.sh` cria um `.env.local` 600 cujos 6 valores passam na forma canônica de §Leitura (teste com o mesmo validador) e sai com código 1 sem alterar nada se o arquivo existir. `materializar-segredos.sh` sai com código 1, citando só o nome, se faltar uma variável ou se o valor estiver fora da forma canônica.
- [ ] `/api/health/ready` com o Postgres ou o Redis fora → 503 `INDISPONIVEL` sem `detalhes` nem nome da dependência (teste de integração).
- [ ] A API não sobe sem qualquer uma das variáveis que §Conexão da API com Postgres e Redis lhe atribui (inclusive `WEB_ORIGIN`), e o `db:migrate` e o `db:seed` não sobem sem as que lhes cabem; a mensagem cita o nome, não o valor (teste de unidade do env). Com `DB_PASSWORD` ou `POSTGRES_USER` definidos, a API os ignora.
- [ ] Para cada um dos 6 segredos, o processo que o usa (API, `db:migrate` ou `db:seed`) não sobe em nenhum destes casos, e a mensagem cita só o nome (teste de unidade do env):
  - `<VAR>` e `<VAR>_FILE` juntos, ou nenhum dos dois;
  - arquivo ausente;
  - valor fora da forma canônica de §Leitura, inclusive com quebra de linha no fim e com um valor de 43 caracteres cuja recodificação difere do texto.
- [ ] Em produção, nenhum dos 6 valores aparece no `docker inspect`, no `docker compose config`, no `docker history` das imagens, no argv dos processos nem no journal da unidade de materialização, pelo método de §Verificação de vazamento (passo do deploy).
- [ ] Papéis do Postgres (teste de integração da tarefa 037, db-dev; ADR 0026). Em `pg_roles`:
  - `leilao_api` tem `rolcanlogin` verdadeiro e `rolsuper`, `rolcreatedb`, `rolcreaterole`, `rolreplication`, `rolbypassrls` e `rolinherit` falsos;
  - não é dono de nenhum objeto: zero linhas em `pg_class` com `relowner` dele nos schemas `public` e `drizzle`;
  - `has_schema_privilege` é falso para `CREATE` em `public` e para `USAGE` em `drizzle`.
- [ ] Matriz de privilégios: para cada tabela existente e cada privilégio de SELECT, INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER e REFERENCES, `has_table_privilege('leilao_api', tabela, privilégio)` é igual à tabela de §Papéis do Postgres (teste que falha se a tabela existir e não estiver na matriz).
- [ ] Conectado como `leilao_api`: `UPDATE` e `DELETE` em `ledger_entries`, `ALTER TABLE ... DISABLE TRIGGER` e `SET session_replication_role = replica` falham com SQLSTATE 42501; `INSERT` e `SELECT` em `ledger_entries` funcionam.
- [ ] `pnpm db:migrate`:
  - roda duas vezes seguidas com saída 0 (a segunda não recria o papel);
  - com `POSTGRES_API_USER` diferente de `leilao_api`, sai com código ≠ 0 e a mensagem cita só o nome da variável;
  - depois dele, o login como `leilao_api` com `DB_API_PASSWORD` funciona, e a senha não aparece no argv, na saída nem no log do Postgres (mesmo método do `db:sync-password`).
- [ ] Em produção, o `docker inspect` e o `docker compose config` do serviço da API não mostram `DB_PASSWORD_FILE` nem o secret `db_password` (passo do deploy).
- [ ] Depois de `sudo reboot` da VPS, `/api/health/ready` volta a responder 200 em até 5 min sem intervenção.
- [ ] Memória: com os limites de §Produção, depois do k6 (rodado de fora da VPS), nenhum container tem `State.OOMKilled` verdadeiro.
- [ ] Backup manual (ADR 0034): o runbook traz o comando de §Backup; antes da entrega, ele roda uma vez na VPS, o dump fica com modo 600 e `pg_restore --list` o lê com saída 0.
- [ ] O README avisa que o k6 roda de fora da VPS e que `pnpm demo:adulterar` nunca roda em produção.

Fora do escopo da entrega (ADR 0034), sem critério de aceite: backup diário com 7 cópias, cópia externa cifrada com `age`, teste de restauração no CI, restauração real registrada no runbook e alerta do UptimeRobot.

## Decisões relacionadas
- decisions/0013-deploy-gcp-e2-micro.md (substituída pela 0033), 0015-segredos-gcp-secret-manager.md (substituída pela 0023), 0017-ci-cd-github-actions.md, 0018-observabilidade-e-backup.md (parcialmente substituída pela 0033 e pela 0034), 0020-host-publico-e-uptime.md (substituída pela 0033), 0023-segredos-em-arquivo-e-formatos.md, 0024-limites-do-caddy-swap-e-http3.md, 0026-papeis-do-postgres.md, 0027-complementos-da-f1.md, 0033-producao-em-vps-hostinger.md (parcialmente substituída pela 0034), 0034-backup-e-uptime-fora-da-entrega.md
