# Deploy e produção

Fonte: specs/014 (§Servidor, §Produção, §Segredos, §CI/CD, §Backup), ADR 0023, ADR 0033 (VPS Hostinger, que substitui a 0013 e a 0020) e ADR 0034 (backup e uptime fora da entrega). Variáveis e formatos: [variaveis-de-ambiente.md](variaveis-de-ambiente.md).

Este documento descreve o compose de produção para a VPS (tarefa 129), a entrega dos segredos e o deploy pela main (tarefa 131). O hardening do servidor, a instalação dos segredos e do comando forçado na VPS, a verificação, a rotação e o backup manual estão no runbook [operacao.md](operacao.md). Não há backup agendado nem monitor de uptime na entrega (ADR 0034): só um `pg_dump` manual, descrito no runbook. Onde este texto e a specs/014 divergirem, vale a spec.

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
  - num `docker build` direto, `--build-context migrations=database/postgres/migrations`;
  - no workflow de deploy, `build-contexts: migrations=database/postgres/migrations` do `docker/build-push-action`.
  Sem esse contexto o build falha (`failed to resolve source metadata for docker.io/library/migrations:latest`), nunca gera uma imagem sem as migrations.

### Teste local

Com segredos descartáveis num diretório próprio (os 6 arquivos, uid 1000, 600, sem quebra de linha; diretório 700) e a CA local do Caddy. As variáveis do shell vencem as dos `--env-file`.

A imagem da API roda com `NODE_ENV=production` e, desde a tarefa 020, recusa `WEB_ORIGIN` de loopback (`localhost`, `*.localhost`, `127.x`, `::1` e variantes) e não sobe. A recusa fica como está. Use um nome que não seja loopback, mas que o Caddy assine pela CA local (os sufixos `.internal`, `.local` e `.home.arpa`, ou IP, não passam pelo Let's Encrypt) e que o seu cliente resolva para a máquina:

```sh
export CADDY_SITE_ADDRESS=leilao.internal LEILAO_SECRETS_DIR=<diretório com os 6 arquivos>
# Porta 80 ocupada no host? CADDY_HTTP_PORT=18080 (o redirecionamento continua indo para https://leilao.internal/).
docker compose -p leilao-prod --env-file .env --env-file infra/prod.env -f infra/docker-compose.prod.yml build
docker compose -p leilao-prod --env-file .env --env-file infra/prod.env -f infra/docker-compose.prod.yml --profile ops run --rm migrate
docker compose -p leilao-prod --env-file .env --env-file infra/prod.env -f infra/docker-compose.prod.yml up -d --no-build --wait
curl -k --resolve leilao.internal:443:127.0.0.1 https://leilao.internal/api/health/ready
```

O `--resolve` dispensa mexer no `/etc/hosts`; para abrir a SPA no navegador, acrescente `127.0.0.1 leilao.internal` ao `/etc/hosts` e remova depois. O compose fixa a rede `borda` em `10.89.0.0/24` (`BORDA_SUBNET`, repassada à API como `TRUSTED_PROXY_CIDR`); se essa faixa colidir com uma rede da sua máquina, exporte outra `BORDA_SUBNET`.

Para limpar: `docker compose -p leilao-prod -f infra/docker-compose.prod.yml down`, e `docker volume rm leilao-prod_pgdata leilao-prod_caddy_data` só na máquina local.

## Deploy pela main (tarefa 131)

`.github/workflows/deploy.yml` roda por `workflow_run` quando o workflow `CI` termina com sucesso num push na `main` (nunca em pull request, nunca com `pull_request_target`), com `concurrency` sem cancelamento. Ele trabalha sobre o `head_sha` que o CI testou.

1. **`guarda`** (`contents: read`): só a ponta da `main` publica. Ela compara o `head_sha` com o último commit da `main` (`gh api repos/<owner>/<repo>/commits/heads/main`); se outro push já chegou, o run termina verde com um aviso (`::notice::`) e os jobs seguintes são pulados. Assim um run atrasado não troca uma versão nova por uma velha.
2. **`imagens`** (único job com `packages: write`): build `linux/amd64` de `apps/api/Dockerfile` e `apps/web/Dockerfile` com contexto no checkout do commit, cache `type=gha` por imagem e push para `ghcr.io/<owner>/leilao-api:<sha>` e `leilao-web:<sha>` (dono em minúsculas), com o label `org.opencontainers.image.source` apontando para o repositório (o pacote do GHCR fica ligado a ele). Login no GHCR com o `GITHUB_TOKEN` do job.
3. **`deploy`** (`contents: read`): confere de novo a ponta da `main` (um "Re-run failed jobs" de um run antigo reaproveita a saída da `guarda` e, sem isso, publicaria um sha velho); se não for a ponta, termina verde com o aviso. Depois monta um tar com exatamente `.env`, `infra/prod.env` e `infra/docker-compose.prod.yml` do commit e o envia pelo stdin de `ssh deploy@<VPS_HOST> "deploy <sha>"`. A chave vem de `VPS_SSH_KEY` e a chave de host fica fixada por `VPS_KNOWN_HOSTS` (`StrictHostKeyChecking=yes`, sem o `known_hosts` do runner). Os dois valores só passam por `printf` para arquivos 600 no `$RUNNER_TEMP`, apagados no fim.

Actions fixadas por SHA de commit. Nenhum segredo da aplicação vai para o GitHub; lá ficam só `VPS_SSH_KEY`, `VPS_KNOWN_HOSTS` e a variável `VPS_HOST`, no nível do repositório: no plano Free, Environments só existem em repositório público, e o repositório é privado (specs/014 §CI/CD aceita os dois lugares). Os pacotes do GHCR são públicos (ADR 0033 item 5.6): a VPS não guarda credencial do registry.

**RISCO ACEITO:** a chave de deploy equivale a root na VPS de demo, porque o `deploy` está no grupo `docker` e o compose que o `deploy-ssh` sobe vem do cliente (o pacote do commit). Mitigação: a chave privada só existe no GitHub Secret `VPS_SSH_KEY`, as actions são fixadas por SHA e o job `deploy` não executa código do repositório (só monta o tar e chama o `ssh`). Melhoria futura registrada: extrair o compose de dentro da imagem publicada, em vez de recebê-lo do cliente.

### Na VPS: `deploy-ssh`

A chave de deploy só executa `/opt/leilao/bin/deploy-ssh` (`command=...,restrict` no `authorized_keys`, modelo em `infra/deploy/authorized_keys.exemplo`). Ele lê `SSH_ORIGINAL_COMMAND` e aceita só `deploy <sha de 40 hex>` e `rollback`; qualquer outra coisa (sessão sem comando, `id`, `backup`, sha inválido) sai 1 sem executar nada.

`deploy <sha>`, nesta ordem:

1. recebe o tar num diretório provisório: até 1 MiB, inteiro em até 60 s (um cliente parado não segura a trava), sem compressão (o `tar` lê sempre pelo stdin, que recusa um `.tgz`; lido de um arquivo, ele o abriria sozinho), só os 3 arquivos comuns e cada um com até 1 MiB depois de extraído (um membro esparso declara o tamanho real e é recusado antes da extração, que ainda roda com `ulimit -f`);
2. confere que o compose resolvido usa `API_IMAGE` e `WEB_IMAGE` do sha (`config --images`);
3. `docker compose pull` e as duas imagens presentes;
4. confere os 6 arquivos de segredo (arquivos comuns, não vazios, legíveis pelo uid 1000) num container descartável da imagem da API, sem rede, porque o `deploy` não lê `/run/leilao/secrets` (700 root);
5. `swapon --show` com swap ativa;
6. `--profile ops run --rm -T --pull never migrate`;
7. `up -d --no-build --pull never --remove-orphans` (nunca há build na VPS);
8. `https://<host>/api/health/ready` 200 por até 60 s e `https://<host>/` 200 (`<host>` é o `CADDY_SITE_ADDRESS` do `infra/prod.env`);
9. `verificar-vazamento.sh` (specs/014 §Verificação de vazamento);
10. o diretório provisório vira `releases/<sha>`, `atual` aponta para ele e `anterior` para a versão que estava no ar; imagens e releases fora dessas duas são removidas.

Falha em 1 a 6: nada no ar muda e o job falha. Falha em 7 a 9: volta para a versão que estava no ar (o compose e as imagens dela), confere o health e o job falha; no primeiro deploy, só falha. O rollback não desfaz migrations: toda migration tem de funcionar com a imagem anterior (specs/014 §CI/CD).

O estado fica em `/home/deploy/leilao`: `releases/<sha>/` (os 3 arquivos) e os links `atual` e `anterior`. Os comandos do runbook usam `/home/deploy/leilao/atual` como diretório do compose. Resíduos de uma execução morta (`releases/.novo.*` e `releases/.pacote.*`) são apagados no início da seguinte, já com a trava.

Queda do SSH ou cancelamento do job no meio do deploy não interrompem o `deploy-ssh`: ele ignora SIGHUP e SIGPIPE, e a saída passa por repassadores que, com o cliente fora, descartam o resto em vez de falhar. O fluxo vai até o fim, inclusive o rollback se o health falhar depois do `up`; o job fica vermelho (o `ssh` sai 255) e o resultado real aparece em `readlink /home/deploy/leilao/atual`.

Enquanto isso, o `deploy-ssh` que ficou rodando na VPS segura a trava (`/home/deploy/leilao/.trava`): o run seguinte que chegar nesse intervalo falha com `outro deploy ou rollback em andamento`, sem mudar nada no ar. Espere alguns minutos (o deploy anterior termina sozinho) e dê "Re-run failed jobs" no run da ponta da `main`.

Um run intermediário substituído pelo `concurrency` (outro push chegou antes de ele rodar) não publica, e se o commit seguinte falhar no CI, aquele commit intermediário nunca é publicado: por desenho, só a ponta da `main` publica.

### Verificação de vazamento

`verificar-vazamento.sh` aplica `grep -qF -f /run/leilao/secrets/<nome>` às saídas de `docker inspect` dos containers do projeto, `docker compose config` (sem `--quiet`), `docker history --no-trunc` das duas imagens, `ps -eww -o args=` e `journalctl -u leilao-segredos.service`. O grep roda num container auxiliar da imagem da API (sem rede, só leitura, sem capabilities, uid 1000) que monta só os 6 arquivos; as saídas só passam pelo pipe. Ele imprime só `<segredo>: <fonte>` e sai 1 se houver ocorrência, ou `nenhum segredo nas saídas do Docker`. Uma fonte que falha, ou o journal da unidade vazio ou ilegível, sai 2 (falha fechada): o `deploy` precisa estar no grupo `systemd-journal`.

### Instalação na VPS e no GitHub

Quem executa é o humano; nenhum agente acessa a VPS nem os secrets do GitHub. Pré-requisitos: [operacao.md](operacao.md) §3 (servidor preparado, `leilao-segredos.service` ativo).

**1. Comando forçado.** Da sua máquina, na raiz do repositório:

```sh
scp infra/deploy/deploy-ssh infra/deploy/verificar-vazamento.sh eliel@teste-verzel.duckdns.org:~/leilao-setup/
```

Na VPS, como `eliel`:

```sh
sudo install -o root -g root -m 755 ~/leilao-setup/deploy-ssh ~/leilao-setup/verificar-vazamento.sh /opt/leilao/bin/
# A verificação de vazamento lê o journal da leilao-segredos.service (o deploy já equivale a root pelo grupo docker).
sudo usermod -aG systemd-journal deploy
```

Os dois scripts pertencem ao root e o `deploy` não os altera; quando mudarem no repositório, repita este passo.

**Avisos.**

- Os comandos `sudo` deste roteiro (e o `sudo -n true` do [operacao.md](operacao.md) §3.2) supõem o NOPASSWD do `eliel` em `/etc/sudoers.d/90-eliel`. Sem ele, o `sudo` pede a senha do `eliel`: com a conta sem senha, o `sudo` falha e ele fica sem como administrar a VPS. Confira com `sudo -n true` numa segunda sessão antes de fechar a primeira, e valide qualquer edição do sudoers com `visudo -cf`.
- O `preparar-vps.sh` recusa o administrador cuja `authorized_keys` não passa no `ssh-keygen -l` ou cujo home, `.ssh` e `authorized_keys` aceitam escrita de grupo/outros, e só recarrega o sshd se o `sshd -T` listar o administrador em `allowusers`; em qualquer recusa ele não fecha o SSH.
- `pnpm demo:adulterar` **nunca roda na VPS**: ele adultera um lance direto no banco para a demonstração. Só roda na máquina de dev, com `DEMO_ADULTERAR=1` e `POSTGRES_HOST` em loopback; o host `postgres` do compose é recusado.

**2. Chave de deploy.** Na sua máquina, num diretório fora do repositório (sem senha: quem a usa é o CI):

```sh
ssh-keygen -t ed25519 -N '' -C deploy@github-actions -f deploy_key
scp deploy_key.pub eliel@teste-verzel.duckdns.org:~/leilao-setup/
```

Na VPS, a chave pública entra como **a única linha** do `authorized_keys` do `deploy`, sempre com o prefixo de `infra/deploy/authorized_keys.exemplo`:

```sh
sudo install -d -o deploy -g deploy -m 700 /home/deploy/.ssh
{ printf 'command="/opt/leilao/bin/deploy-ssh",restrict '; cat ~/leilao-setup/deploy_key.pub; } \
  | sudo tee /home/deploy/.ssh/authorized_keys >/dev/null
sudo chown deploy:deploy /home/deploy/.ssh/authorized_keys
sudo chmod 600 /home/deploy/.ssh/authorized_keys
sudo cat /home/deploy/.ssh/authorized_keys   # 1 linha: command="/opt/leilao/bin/deploy-ssh",restrict ssh-ed25519 ...
```

**3. Chave de host fixada.** Na VPS, por uma sessão em que você já confia:

```sh
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

Na sua máquina; a impressão digital (`SHA256:...`) tem de ser a mesma, senão pare:

```sh
ssh-keyscan -t ed25519 teste-verzel.duckdns.org > known_hosts.vps
ssh-keygen -lf known_hosts.vps
```

**4. GitHub** (no nível do repositório; os valores vêm do stdin, sem passar por argv):

```sh
gh secret set VPS_SSH_KEY < deploy_key
gh secret set VPS_KNOWN_HOSTS < known_hosts.vps
gh variable set VPS_HOST --body teste-verzel.duckdns.org
```

Guarde a `deploy_key` local até o fim do passo 7, que ainda a usa; ela nunca vai para a VPS nem para o Git.

**5. Primeiro run e GHCR público** (ADR 0033 item 5.6). A ordem esperada do primeiro run é:

1. o job `imagens` cria `leilao-api` e `leilao-web` como pacotes **privados**, e o job `deploy` falha no pull (`denied`): falha esperada, nada no ar muda;
2. em github.com → seu perfil → Packages → `leilao-api` → Package settings → Change visibility → Public; repita para `leilao-web`. Isso é irreversível (um pacote público não volta a privado) e as imagens não têm segredo (a verificação de vazamento olha o `docker history`);
3. em Actions, "Re-run failed jobs" no run do Deploy.

**AVISO:** não deixe a `main` andar (nenhum push) entre o primeiro run e o "Re-run failed jobs". Se ela andar, o re-run do run antigo termina **verde sem publicar nada**: o job `deploy` vê que o sha já não é a ponta e sai com o aviso `::notice::<sha> não é mais a ponta da main (...); nada a publicar`. Nesse caso, quem faz o deploy é o run do commit novo, depois de os pacotes ficarem públicos (se ele já tiver falhado no pull, dê "Re-run failed jobs" nele). Verde não quer dizer publicado: confira sempre `sudo readlink /home/deploy/leilao/atual` na VPS (o diretório é do `deploy`) ou o log do job `deploy`.

No **primeiro** deploy, o health pode falhar se o Caddy demorar mais de 60 s para obter o certificado ACME do Let's Encrypt (sem versão anterior, o `deploy-ssh` só sai ≠ 0 e deixa os containers no ar). A solução é outro "Re-run failed jobs", sem mudar nada: o certificado já obtido fica no volume `caddy_data`.

**6. Verificação.** A chave não abre shell nem roda outro comando (cada linha mostra "comando recusado" e saída 1):

```sh
ssh -i deploy_key -o IdentitiesOnly=yes deploy@teste-verzel.duckdns.org; echo "saída $?"
ssh -i deploy_key -o IdentitiesOnly=yes deploy@teste-verzel.duckdns.org id; echo "saída $?"
ssh -i deploy_key -o IdentitiesOnly=yes deploy@teste-verzel.duckdns.org backup; echo "saída $?"
ssh -i deploy_key -o IdentitiesOnly=yes deploy@teste-verzel.duckdns.org 'deploy abc'; echo "saída $?"
```

Depois de um push na `main`, o run do Deploy termina verde em até 10 min depois do CI, e o log mostra `nenhum segredo nas saídas do Docker` e nenhum valor. Na VPS, as imagens no ar são as do commit:

```sh
SHA="$(basename "$(sudo readlink /home/deploy/leilao/atual)")"; echo "$SHA"
R=/home/deploy/leilao/atual
sudo env API_IMAGE="ghcr.io/elieldelfino/leilao-api:$SHA" WEB_IMAGE="ghcr.io/elieldelfino/leilao-web:$SHA" \
  docker compose -p leilao-prod --env-file "$R/.env" --env-file "$R/infra/prod.env" \
  -f "$R/infra/docker-compose.prod.yml" images
```

**7. Rollback automático com `/ready` quebrado.** Ainda com a `deploy_key` local, reenvie o commit no ar com um compose em que a API não alcança o Redis (`/api/health/ready` responde 503). O `deploy-ssh` volta sozinho para os arquivos e as imagens que estavam no ar e sai 1:

```sh
SHA=<sha no ar, do passo 6>
d="$(mktemp -d)"
git archive "$SHA" .env infra/prod.env infra/docker-compose.prod.yml | tar -x -C "$d"
sed -i 's/^      REDIS_HOST: redis$/      REDIS_HOST: redis-quebrado/' "$d/infra/docker-compose.prod.yml"
tar -cf "$d.tar" -C "$d" --owner=0 --group=0 --numeric-owner .env infra/prod.env infra/docker-compose.prod.yml
ssh -i deploy_key -o IdentitiesOnly=yes deploy@teste-verzel.duckdns.org "deploy $SHA" < "$d.tar"; echo "saída $?"   # ≠ 0
curl -fsS -o /dev/null -w '%{http_code}\n' https://teste-verzel.duckdns.org/api/health/ready                      # 200
```

Pelo job, o mesmo teste é um commit na `main` com essa troca, seguido do revert (o run do Deploy do primeiro falha e o site continua na versão anterior).

Terminado o passo 7, apague a cópia local da chave privada (`shred -u deploy_key`) ou guarde-a num gerenciador de senhas; o rollback manual abaixo funciona sem ela, direto na VPS.

**Rollback manual** (volta para a versão `anterior`; um segundo rollback desfaz o primeiro): `ssh -i deploy_key deploy@teste-verzel.duckdns.org rollback`, ou, sem a chave, na VPS: `sudo -u deploy -H env SSH_ORIGINAL_COMMAND=rollback /opt/leilao/bin/deploy-ssh`. O rollback não desfaz migrations.

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
