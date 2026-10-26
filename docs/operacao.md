# Operação da VPS (runbook)

Fonte: specs/014 (§Servidor, §Segredos, §Backup), ADR 0033 (VPS Hostinger) e ADR 0034 (backup e uptime fora da entrega). Compose e segredos: [deploy.md](deploy.md); nomes e formatos: [variaveis-de-ambiente.md](variaveis-de-ambiente.md). Onde este texto e a specs/014 divergirem, vale a spec.

Quem executa tudo aqui é o humano. Nenhum agente acessa a VPS. Host: `teste-verzel.duckdns.org` (Ubuntu 24.04 LTS, 1 vCPU, 4 GB, IPv4 e IPv6). Administrador: `eliel` (uid 1000, sudo). CI: `deploy` (fora do grupo `sudo`, no grupo `docker`).

**O grupo `docker` equivale a root:** quem fala com o daemon do Docker monta `/` do host num container e faz o que quiser. Não ter `sudo` não contém o `deploy`. Por isso a chave pública do `deploy` só pode entrar no `~deploy/.ssh/authorized_keys` com o prefixo `command="/opt/leilao/bin/deploy-ssh",restrict` (tarefa 131), **nunca como chave livre**; o `preparar-vps.sh` não instala chave nenhuma para ele.

**Regra de ouro:** nunca rode `cat`, `less`, `grep` sem `-q`, `docker compose config --environment` ou `set -x` sobre `/opt/leilao/.env.local` ou `/run/leilao/secrets/`, e nunca cole a saída deles em issue, PR, chat ou neste arquivo. Os comandos abaixo mostram só nomes, modos, tamanhos e códigos de saída.

## Serviços externos

São só estes, e nenhum é cobrado por uso (specs/014, critério de custo; ADR 0034, item 4):

| Serviço | Uso | Custo |
|---|---|---|
| VPS Hostinger | servidor de produção | preço fixo do plano |
| DuckDNS | nome `teste-verzel.duckdns.org` (registros A e AAAA) | gratuito |
| Let's Encrypt | certificado TLS, emitido e renovado pelo Caddy | gratuito |
| GitHub | repositório, Actions (CI e deploy) e GHCR (imagens) | plano gratuito |

Não há alerta de orçamento: o único custo é o preço fixo da VPS.

## 1. hPanel (Hostinger)

1. Sistema operacional: **Ubuntu 24.04 LTS limpo, sem painel** (nada de Coolify, Dokploy, CloudPanel, HestiaCP ou similar; ADR 0033 item 1).
2. Chave SSH: cadastre a sua chave **pública** (`~/.ssh/id_ed25519.pub`) no hPanel antes de instalar o sistema, para o primeiro acesso como root já ser por chave.
3. Anote o IPv4 e o IPv6 públicos da VPS (aba de visão geral). São fixos.
4. Firewall do hPanel: não é necessário; quem filtra é o UFW (§3). Se ativar o do hPanel, libere só 22, 80 e 443 TCP.

## 2. DuckDNS

1. Em <https://www.duckdns.org>, entre com a sua conta e crie o subdomínio `teste-verzel`.
2. No campo **current ip**, informe o IPv4 da VPS; no campo **ipv6**, o IPv6. Clique em **update ip** para cada um.
3. Não há atualizador de IP (o IP é fixo): o token do DuckDNS não vai para a VPS nem para o GitHub.
4. Confira de fora:

   ```sh
   dig +short A teste-verzel.duckdns.org      # IPv4 da VPS
   dig +short AAAA teste-verzel.duckdns.org   # IPv6 da VPS
   ```

   O AAAA tem de apontar para a VPS ou ser apagado: o Let's Encrypt prefere o IPv6 quando ele existe, e um AAAA errado derruba a emissão do certificado (desafio HTTP-01 na porta 80).

## 3. Preparar o servidor

Já feito à mão em 2026-10-25: usuários `eliel` e `deploy`, UFW 22/80/443, drop-in do sshd e unattended-upgrades. O `preparar-vps.sh` é idempotente e só completa o que faltar.

### 3.1 Copiar os arquivos

Da sua máquina, na raiz do repositório:

```sh
ssh eliel@teste-verzel.duckdns.org 'mkdir -p ~/leilao-setup'
scp -r infra/vps infra/deploy/gerar-env-local.sh infra/deploy/materializar-segredos.sh \
  infra/deploy/leilao-segredos.service eliel@teste-verzel.duckdns.org:~/leilao-setup/
```

### 3.2 Ordem de execução (sem se trancar para fora)

1. **Sessão A:** abra uma sessão SSH (root, se ainda entrar, ou `eliel`) e **não a feche** até o passo 6. Ela é a sua volta se o sshd recusar o novo login.
2. Na sessão A, veja o que seria feito (não altera nada):

   ```sh
   sudo ~/leilao-setup/vps/preparar-vps.sh --dry-run eliel
   ```

   O script para antes de qualquer mudança se `eliel` não existir, não tiver uid 1000, não estiver no grupo `sudo` ou não tiver chave em `~/.ssh/authorized_keys`, e também se houver pacote do Docker do Ubuntu (`docker.io`, `containerd`, `runc` etc.): remova-os à mão antes. Ele avisa (sem apagar) regras do UFW além de 22, 80 e 443.
3. Aplique:

   ```sh
   sudo ~/leilao-setup/vps/preparar-vps.sh eliel
   ```

   Ele roda `sshd -t` antes do reload; se o teste falhar, restaura o drop-in anterior e para.
4. **Sessão B** (outro terminal da sua máquina), sem fechar a A:

   ```sh
   ssh eliel@teste-verzel.duckdns.org 'sudo -n true && echo admin ok'
   ssh root@teste-verzel.duckdns.org true                     # tem de ser recusado
   ssh -o PubkeyAuthentication=no -o PreferredAuthentications=password,keyboard-interactive \
     eliel@teste-verzel.duckdns.org true                       # tem de dar "Permission denied (publickey)"
   ```

5. Se a sessão B falhar, corrija pela sessão A (o drop-in é `/etc/ssh/sshd_config.d/00-leilao.conf`; depois `sudo sshd -t && sudo systemctl try-reload-or-restart ssh.service`).
6. Só com a sessão B funcionando, feche a sessão A.
7. Rode o passo 3 de novo: a última linha tem de ser `preparar-vps: concluído: 0 alterações`.

Antes de acrescentar a linha do swap ao `/etc/fstab`, o script guarda uma cópia (`/etc/fstab.antes-leilao-<data UTC>`) e garante a quebra de linha final; a linha nova é `/swapfile none swap sw,nofail 0 0`. Se ele avisar que uma linha do `/swapfile` feita à mão não tem `nofail`, edite-a com `sudoedit /etc/fstab` (trocando `sw` por `sw,nofail`) e confira com `sudo findmnt --verify` antes de reiniciar.

### 3.3 Segredos

Na VPS, como `eliel`:

```sh
cd ~/leilao-setup
sudo install -o root -g root -m 755 gerar-env-local.sh materializar-segredos.sh /opt/leilao/bin/
sudo install -o root -g root -m 644 leilao-segredos.service /etc/systemd/system/
sudo /opt/leilao/bin/gerar-env-local.sh            # uma vez; uma 2ª execução sai 1 sem tocar no arquivo
sudo systemctl daemon-reload
sudo systemctl enable --now leilao-segredos.service
```

- `gerar-env-local.sh` cria `/opt/leilao/.env.local` (root, 600) com os 6 segredos e imprime só os nomes.
- `leilao-segredos.service` roda `materializar-segredos.sh` a cada boot, antes do `docker.service`: grava `/run/leilao/secrets/<nome>` (diretório 700; arquivos 600, dono uid 1000, sem quebra de linha). Ele sai com código 1, citando só o nome, se faltar uma variável ou se um valor estiver fora da forma canônica, e recusa um `.env.local` com permissão diferente de 600.
- **Guarde uma cópia do `.env.local` fora da VPS só se tiver onde guardá-la com segurança** (gerenciador de senhas). Sem cópia, perder a VPS significa segredos novos, com as consequências de §6.

## 4. Verificação

Rode na VPS e cole as saídas em §8. Nenhum destes comandos mostra valor de segredo.

```sh
# SSH: valores efetivos (o primeiro valor lido vence)
sudo sshd -T | grep -Ei '^(permitrootlogin|passwordauthentication|kbdinteractiveauthentication|allowusers) '
# esperado: permitrootlogin no / passwordauthentication no / kbdinteractiveauthentication no / allowusers eliel deploy

# Firewall: deny (incoming); 22/tcp LIMIT, 80/tcp e 443/tcp ALLOW, em v4 e (v6)
sudo ufw status verbose

# unattended-upgrades: ligado, só segurança, sem reinício automático
apt-config dump | grep -E 'APT::Periodic::Unattended-Upgrade|Unattended-Upgrade::Automatic-Reboot |Unattended-Upgrade::Allowed-Origins'
sudo unattended-upgrade --dry-run --debug 2>&1 | grep -i 'allowed origins'
systemctl list-timers 'apt-daily*' --no-pager

# journald limitado a 500 MB; swap de 2 GB; Docker oficial
systemd-analyze cat-config systemd/journald.conf | grep -E '^SystemMaxUse'
swapon --show
docker --version && docker compose version
apt-cache policy docker-ce | sed -n '1,3p'          # origem download.docker.com

# Usuários: deploy fora do sudo e no grupo docker (que equivale a root; ver o topo)
id eliel; id deploy
sudo -l -U deploy                                   # esperado: "not allowed to run sudo"

# Diretórios
sudo stat -c '%a %U %n' /opt/leilao /opt/leilao/bin /var/backups/leilao   # 755, 755, 700, root

# Segredos: só nomes, modos, donos e tamanhos (43 bytes = sem quebra de linha).
# O diretório é 700 root: o glob tem de ser expandido pelo shell do sudo, não pelo seu.
sudo stat -c '%a %U %n' /opt/leilao/.env.local                           # 600 root
sudo sh -c 'stat -c "%a %u %s %n" /run/leilao/secrets /run/leilao/secrets/*'   # 700; 600 1000 43
systemctl status leilao-segredos.service --no-pager
```

O `unattended-upgrades` só aplica as origens de segurança do Ubuntu: **atualizações do `docker-ce` e do `containerd.io` (repositório da Docker) são manuais**, com `sudo apt-get update && sudo apt-get upgrade`, fora de leilão ao vivo (reiniciar o Docker derruba os containers).

De **fora** da VPS (sua máquina), a varredura TCP tem de achar só 22, 80 e 443 abertas, em IPv4 e IPv6:

```sh
nmap -Pn -p- --open teste-verzel.duckdns.org
nmap -6 -Pn -p- --open teste-verzel.duckdns.org
```

Lembre: porta publicada pelo Docker passa por fora do UFW, então só o Caddy pode ter `ports:` (specs/014 §Servidor).

## 5. Reinício

- O `unattended-upgrades` não reinicia sozinho. Quando `/var/run/reboot-required` existir (`ls /var/run/reboot-required`; o `preparar-vps.sh` também avisa), reinicie **fora de leilão ao vivo**: confira na vitrine que não há lote "ao vivo" nem prestes a começar.
- Depois de `sudo reboot`, em até 5 min e sem intervenção:

  ```sh
  systemctl status leilao-segredos.service --no-pager          # active (exited), sem erro
  sudo sh -c 'stat -c "%a %u %s %n" /run/leilao/secrets/*'      # os 6 arquivos, 600 1000 43
  journalctl -b -u leilao-segredos.service -u docker.service -o short-monotonic --no-pager | head -20
  curl -fsS -o /dev/null -w '%{http_code}\n' https://teste-verzel.duckdns.org/api/health/ready   # 200
  ```

  O journal mostra a unidade de segredos terminando antes de o Docker subir (ela só imprime nomes).

## 6. Rotação de segredos

A rotação é manual (specs/014 §Produção). Rotação de `JWT_SECRET` e de `DB_API_PASSWORD`, e o recreate da `api` que vem depois, são feitos **fora de leilão ao vivo**. O valor novo é gerado e gravado só por builtins do bash dentro do `sudo`: não passa por argv, não aparece na tela e o `.env.local` continua 600. Troque `JWT_SECRET` pelo nome do segredo:

```sh
sudo bash -s JWT_SECRET <<'EOF'
set -euo pipefail
umask 077
nome="$1"; arquivo=/opt/leilao/.env.local
grep -q "^${nome}=" "$arquivo" || { echo "$nome não está em $arquivo" >&2; exit 1; }
novo="$(head -c 32 /dev/urandom | base64 -w 0 | tr '+/' '-_' | tr -d '=\n')"
while IFS= read -r linha || [[ -n $linha ]]; do
  if [[ $linha == "${nome}="* ]]; then printf '%s=%s\n' "$nome" "$novo"; else printf '%s\n' "$linha"; fi
done <"$arquivo" >"$arquivo.novo"
mv -f "$arquivo.novo" "$arquivo"
echo "$nome trocado"
EOF
sudo /opt/leilao/bin/materializar-segredos.sh
```

Depois, recrie os serviços que usam o segredo com `up -d --force-recreate` seguido dos nomes da coluna "Recriar" (por exemplo `up -d --force-recreate api`; o `up -d` sozinho não recria: o bind mount do secret continua no arquivo antigo até o container ser recriado), usando os mesmos `-p`, `--env-file` e `-f` do deploy (§7). Consequências (ADR 0023 e 0031):

| Segredo | Recriar | Consequência |
|---|---|---|
| `JWT_SECRET` | `api` | os access tokens em circulação deixam de valer; os usuários renovam a sessão |
| `PSEUDONYM_HMAC_KEY` | `api` | **não troque com lote aberto** (agendado ou ao vivo; ADR 0031): o pseudônimo do mesmo licitante mudaria no meio do lote |
| `ED25519_PRIVATE_KEY` | `api` | a chave pública antiga continua em `signing_keys`, então lances e selos antigos seguem verificáveis; os novos usam a chave nova |
| `DB_API_PASSWORD` | rode o one-shot de migrations (aplica a senha nova ao papel `leilao_api` com verificador SCRAM) e depois `api` | sem o migrate, a API não conecta |
| `REDIS_PASSWORD` | `redis` e `api` juntos | o Redis lê a senha ao iniciar; a API perde a conexão até ser recriada |
| `DB_PASSWORD` | ver abaixo | o Postgres só lê `POSTGRES_PASSWORD_FILE` ao criar o volume |

`DB_PASSWORD` (dono `leilao`): trocar o arquivo não muda a senha do papel no volume existente, e o one-shot de migrations deixaria de conectar. Não há comando de produção para aplicar a senha nova sem passá-la em texto ao servidor (o `pnpm db:sync-password` é de dev). Só rotacione se ela vazou, e trate isso como incidente com o orquestrador antes.

## 7. Backup manual (ADR 0034)

Na entrega há só um `pg_dump -Fc` manual do banco `leilao`, feito uma vez pelo administrador antes da entrega (specs/014 §Backup). Backup agendado, cópia externa e teste de restauração estão fora da entrega.

O dump sai pelo socket local do container do Postgres (`docker compose exec -T postgres`, sem senha no argv nem no ambiente) e é gravado em `/var/backups/leilao/` (root, 700), fora dos volumes do Docker, com modo 600 (`umask 077`). A saída do `pg_dump` vai direto ao arquivo, nunca ao terminal. O dump contém os e-mails e os hashes de senha dos usuários: não o copie para lugar compartilhado.

Os `-p`, `--env-file` e `-f` são os do deploy (specs/014 §Produção). O diretório do compose na VPS é definido pelo `deploy-ssh` (tarefa 131); até ela, use o do comando abaixo e ajuste se mudar:

```sh
cd /opt/leilao
COMPOSE='docker compose -p leilao-prod --env-file .env --env-file infra/prod.env -f infra/docker-compose.prod.yml'

# Dump: /var/backups/leilao/leilao-AAAAMMDDTHHMMZ.dump, data em UTC
sudo sh -c "umask 077 && $COMPOSE exec -T postgres pg_dump -Fc -U leilao -d leilao \
  > /var/backups/leilao/leilao-\$(date -u +%Y%m%dT%H%MZ).dump" && echo 'pg_dump: saída 0'

# Dump mais recente; o glob é expandido pelo shell do sudo (o diretório é 700 root)
ARQ="$(sudo sh -c 'ls -t /var/backups/leilao/leilao-*.dump | head -1')"
printf '%s\n' "$ARQ"

# Conferência: modo 600, tamanho > 0 e o pg_restore lê o índice do arquivo (saída 0)
sudo stat -c '%a %U %s %n' "$ARQ"
sudo sh -c "$COMPOSE exec -T postgres pg_restore --list < \"\$1\" > /dev/null" sh "$ARQ" \
  && echo 'pg_restore --list: saída 0'
```

- Se o `pg_dump` pedir senha, pare: não digite nada. O dump por socket local depende de o `pg_hba.conf` da imagem aceitar a conexão local, e uma senha digitada ali é exatamente o que este procedimento evita.
- Um dump com saída ≠ 0 pode ficar incompleto no disco: logo depois da falha ele é o mais recente, então rode a linha do `ARQ=` acima, apague-o com `sudo rm -- "$ARQ"` e rode o dump de novo.
- Copiar o dump para fora da VPS é opcional (`scp` de um arquivo 600; ele contém dados pessoais).

## 8. Registro de verificação (saídas coladas, sem segredos)

Preencha com a data (UTC) e a saída de cada comando de §4, §5 e §7. Nunca cole valores de `.env.local` ou de `/run/leilao/secrets/`.

| Verificação | Data (UTC) | Resultado |
|---|---|---|
| `sshd -T` (permitrootlogin, passwordauthentication, kbdinteractiveauthentication, allowusers) | | |
| `ssh root@` e login por senha recusados | | |
| `ufw status verbose` | | |
| `nmap` de fora, IPv4 e IPv6: só 22, 80 e 443 | | |
| `apt-config dump` e `unattended-upgrade --dry-run`: só segurança, sem `Automatic-Reboot "true"` | | |
| `preparar-vps.sh` 2ª execução: `0 alterações` | | |
| segredos: `.env.local` 600 root; `/run/leilao/secrets` 700, 6 arquivos 600 uid 1000 com 43 bytes | | |
| depois de `sudo reboot`: `leilao-segredos` ativo antes do Docker e `/api/health/ready` 200 em até 5 min | | |
| backup manual: dump 600 em `/var/backups/leilao/` e `pg_restore --list` com saída 0 | | |

```text
(cole aqui as saídas, uma por bloco, com a data)
```
