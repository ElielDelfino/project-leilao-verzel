# 0033 — Produção numa VPS Hostinger com Docker Compose, DuckDNS e segredos em arquivo

Status: aceita, parcialmente substituída por 0034 (item 6, o comando `backup` do item 5.3 e o UptimeRobot do item 7 ficam fora do escopo da entrega; a pendência 6.2 deixa de existir); item 5.6 provisório até a confirmação do humano (ver §Pendências)
Data: 2026-10-25
Decisão: do humano, em 2026-10-25 (abandona o GCP e compra uma VPS; itens 1 a 8 da mudança de plano de deploy, repassados pelo orquestrador). Os números de memória (item 8) foram delegados ao spec-guardian.
Substitui: ADR 0013 (provedor e VM) e ADR 0020 (host público). Substitui parcialmente: ADR 0018 (sai o alerta de orçamento; o backup ganha cópia externa), ADR 0023 (itens 1 e 7: Secret Manager e `fetch-secrets.sh` no boot), ADR 0024 (item 1: limite do Caddy) e ADR 0026 (só a origem do 6º segredo em produção)
Complementa: ADR 0017 (pipeline) e ADR 0014 (metas mantidas)

## Contexto
A produção estava planejada numa e2-micro do GCP (ADR 0013): 1 GB de RAM, limites de 728 MB somados (ADR 0024), segredos no Secret Manager com as 6 versões gratuitas ocupadas (ADR 0026) e host `sslip.io` provisório (ADR 0020). A tarefa 008, que criaria a VM, nunca rodou. Em 2026-10-25 o humano decidiu abandonar o GCP e comprar uma VPS Hostinger (1 vCPU, 4 GB de RAM, 50 GB NVMe, Ubuntu 24.04 LTS limpo), sem domínio próprio. HTTPS continua obrigatório: os cookies `Secure` (specs/003), o CSRF, o `wss` do Socket.IO e a API de clipboard do comprovante exigem contexto seguro.

## Decisão
1. **Servidor.** VPS Hostinger com 1 vCPU, 4 GB de RAM e 50 GB NVMe, Ubuntu 24.04 LTS limpo, **sem painel** (Coolify, Dokploy, CloudPanel, HestiaCP e similares estão fora). Docker Engine e o plugin Docker Compose do repositório apt oficial da Docker. Swap de 2 GB em arquivo. Sem staging: a paridade vem do compose (como na ADR 0013).
2. **Host e TLS.** `<subdominio>.duckdns.org` (o humano escolhe o nome antes do primeiro deploy; até lá, specs e tarefas usam o placeholder `<subdominio>`), com o registro A apontando para o IP público fixo da VPS, configurado uma vez pelo humano no site do DuckDNS. Como o IP é fixo, não há atualizador de IP: o token do DuckDNS não vai para o servidor nem para o GitHub. O Caddy emite e renova o certificado Let's Encrypt sozinho (desafio HTTP-01 na porta 80), sem HTTP/3 (ADR 0024, item 3). HTTP redireciona para HTTPS.
3. **Acesso e rede.**
   1. Um usuário administrador não-root com sudo, criado pelo humano, e um usuário `deploy` sem sudo, no grupo `docker`, usado só pelo CI (item 5).
   2. SSH só por chave: `PermitRootLogin no`, `PasswordAuthentication no`, `KbdInteractiveAuthentication no` e `AllowUsers` com os dois usuários, conferidos pelo valor efetivo de `sshd -T` (no Ubuntu, um arquivo em `/etc/ssh/sshd_config.d/` lido antes pode reativar a senha).
   3. UFW com entrada negada por padrão e só 22/tcp (com `limit`), 80/tcp e 443/tcp liberadas, em IPv4 e IPv6.
   4. Só o Caddy publica portas (80 e 443 TCP). Postgres e Redis ficam na rede `dados` interna do Compose, sem `ports:`. Porta publicada pelo Docker passa por fora das regras do UFW, então nenhum outro serviço pode publicar porta.
   5. `unattended-upgrades` com as atualizações de segurança, **sem reinício automático**: o reinício é manual, fora de leilão ao vivo, e o critério de reboot da specs/014 garante a volta.
4. **Segredos.**
   1. Fonte única no servidor: `/opt/leilao/.env.local` (dono root, modo 600, fora do Git), com os 6 segredos (`DB_PASSWORD`, `DB_API_PASSWORD`, `REDIS_PASSWORD`, `JWT_SECRET`, `PSEUDONYM_HMAC_KEY`, `ED25519_PRIVATE_KEY`) nos formatos da ADR 0023, item 4. Sem Secret Manager e sem segredo da aplicação no GitHub.
   2. O arquivo é gerado **no próprio servidor** por `infra/deploy/gerar-env-local.sh`, equivalente em shell ao `pnpm keys:generate` (o servidor não tem Node nem o repositório): 32 bytes de `/dev/urandom` por segredo em base64url sem padding, sem passar valor por argv, e recusa sobrescrever um arquivo existente.
   3. A entrega à API não muda (ADR 0023, item 2): uma unidade systemd ordenada antes do `docker.service` roda `infra/deploy/materializar-segredos.sh`, que lê o `.env.local` e grava um arquivo por segredo em `/run/leilao/secrets/` (tmpfs, diretório 700, arquivos 600 com dono uid 1000, sem quebra de linha). O compose monta esses arquivos com `secrets:` e a API lê `<VAR>_FILE`.
   4. O `.env.local` nunca é passado ao Compose (nem `--env-file`, nem `env_file:`), nunca vai para log, banco ou saída de comando, e o script de materialização só imprime nomes.
5. **CI/CD** (complementa a ADR 0017).
   1. As imagens são construídas só no GitHub Actions (`linux/amd64`), nunca na VPS, e publicadas no GHCR com a tag `<sha>` do commit.
   2. O deploy só roda depois do CI verde do mesmo commit na `main`, nunca em pull request, com `concurrency` sem cancelamento.
   3. O SSH usa uma chave ed25519 dedicada ao deploy. No `authorized_keys` do usuário `deploy`, ela tem `restrict` e o comando forçado `/opt/leilao/bin/deploy-ssh`, que aceita só `deploy <sha>`, `rollback` e `backup`; qualquer outro comando sai com código ≠ 0. A chave de host da VPS fica fixada no GitHub (`known_hosts`), sem `StrictHostKeyChecking=no`.
   4. Na VPS, o `deploy <sha>` faz: confere os 6 arquivos de segredo → `docker compose pull` das imagens do `<sha>` → migrations num one-shot com a imagem da API → `up -d --no-build` → health check de `https://<host>/api/health/ready` por até 60 s → verificação de vazamento (specs/014). Se o health check ou a verificação falhar, ele volta para as tags anteriores e o job falha.
   5. O rollback não desfaz migrations: toda migration precisa ser compatível com a imagem anterior. Uma migration destrutiva continua exigindo escalonamento (specs/002).
   6. **(provisório)** Pacotes do GHCR **públicos**: a VPS não guarda credencial do registry. Se o humano preferir pacotes privados, o job passa à VPS o `GITHUB_TOKEN` efêmero dele por stdin (`docker login --password-stdin` e `docker logout` no fim). Nunca um token pessoal na VPS.
   7. No GitHub: os secrets `VPS_SSH_KEY` (chave privada de deploy) e `VPS_KNOWN_HOSTS`, e a variável `VPS_HOST` (o nome DuckDNS). Ficam no Environment `production` se o plano do repositório oferecer environments; senão, no nível do repositório.
6. **Backup.**
   1. Um cron diário às 03:00 UTC roda `pg_dump -Fc` e grava o dump em `/var/backups/leilao` (root, 600), mantendo 7 cópias.
   2. **(provisório) Cópia fora da VPS:** um workflow agendado no GitHub Actions chama `backup` pela chave de deploy e recebe o dump mais recente **já cifrado na VPS com `age`** para a chave pública do humano. Ele guarda o arquivo como artefato com retenção de 7 dias. A chave privada `age` fica só com o humano, nunca na VPS nem no GitHub. Não cria conta nova nem custo.
   3. Restauração: o CI testa o restore com um dump gerado no CI (como já previa a specs/014). Antes da entrega, o humano faz uma restauração da cópia externa real, e o runbook registra a data e o veredito de todos os lotes.
7. **Uptime e custo.** Monitor no plano gratuito do UptimeRobot em `https://<host>/api/health/ready`, com alerta por e-mail (mantido da ADR 0020). O alerta de orçamento do GCP sai (ADR 0018): o único custo é o preço fixo da VPS, e nenhum serviço cobrado por uso entra no projeto.
8. **Limites de memória para 4 GB.** Ficam no compose de produção e são lidos de `infra/prod.env` (versionado, sem segredo, carregado depois do `.env`). Os valores de dev no `.env` não mudam.

   | Serviço | RAM | RAM + swap | Outros |
   |---|---|---|---|
   | Postgres | 1 GB | 2 GB | |
   | API | 768 MB | 1,5 GB | heap do Node limitado a 576 MB (`--max-old-space-size=576`, 75% do limite) |
   | Redis | 128 MB | 128 MB (sem swap) | `maxmemory` 96 MB |
   | Caddy | 128 MB | 128 MB (sem swap) | `GOMEMLIMIT` 96 MiB |
   | **Soma** | **2 GB** | | |

   Sobram cerca de 1,8 GB para o sistema, o Docker, o one-shot de migrations, o `pg_dump` e o cache de páginas. Continua valendo a regra de swap da ADR 0024, item 2: 2× o limite só para Postgres e API. Os limites de CPU não mudam (Postgres 1, API 1, Redis 0,5, Caddy 0,5; são tetos, não reservas, sobre 1 vCPU).
9. **O que nunca roda na VPS.** O k6 (specs/013) roda de fora da VPS (máquina do humano ou runner do Actions), para não disputar a CPU que está medindo. `pnpm demo:adulterar` nunca roda em produção: a VPS não tem Node nem o repositório, e o script já recusa `NODE_ENV=production`. O README avisa as duas coisas.

## Pendências (provisórias até a confirmação do humano)
- **5.6, visibilidade do GHCR:** o repositório é privado hoje. Pacote privado no plano gratuito tem cota de armazenamento e de transferência, e cada pull da VPS consome essa cota. Recomendado: pacotes públicos. As imagens não contêm segredo, e a specs/014 verifica isso no `docker history`.
- **6.2, destino da cópia externa do backup:** artefato cifrado do Actions (recomendado) ou outro destino que o humano indicar.

## Alternativas consideradas
- **Continuar no GCP e2-micro:** o humano decidiu sair. Fatos já registrados: 1 GB de RAM com risco de OOM (ADR 0024) e as 6 versões gratuitas do Secret Manager ocupadas, sem espaço para mais um segredo (ADR 0026).
- **Painel de deploy (Coolify, Dokploy, CloudPanel, HestiaCP):** consome RAM e CPU de 1 vCPU e aumenta a superfície exposta. Excluído pelo humano.
- **`sslip.io` (ADR 0020):** dispensa conta, mas o nome carrega o IP; um IP novo muda a URL publicada no README e no formulário. **Domínio próprio:** custo e propagação.
- **`.env.local` como `env_file` do Compose:** é o mais simples, mas expõe os 6 valores no `Config.Env` do `docker inspect` (ADR 0023, alternativas).
- **Só os 6 arquivos persistidos em disco, sem `.env.local`:** dispensa a materialização, mas contraria a decisão do humano de um `.env.local` no servidor e espalha a fonte por 6 arquivos.
- **Build na VPS, ou watchtower puxando a última imagem:** o build disputa 1 vCPU com a produção (excluído pelo humano); o watchtower não ordena as migrations antes da API nem faz rollback por health check.
- **Cópia externa do backup em Backblaze B2 ou Cloudflare R2:** exige conta nova e credencial na VPS. **Na máquina do humano por cron:** depende de a máquina estar ligada. **Snapshots da Hostinger:** frequência e retenção do plano, fora do controle do projeto.
- **Reinício automático do `unattended-upgrades`:** pode derrubar um leilão ao vivo durante a avaliação.

## Consequências
- O RNF-11 da specs/000 passa de "custo zero (free tier GCP)" para "custo fixo da VPS, sem custo variável". As metas da ADR 0014 continuam as mesmas, e o k6 contra a VPS (F5) diz se é preciso reabri-las.
- A specs/014 é reescrita para a VPS. A specs/001 troca a dependência do Secret Manager pelo `.env.local` do servidor, e o PLAN move o deploy da F0 para a F5 (tarefas do infra a partir da 129). A tarefa 008 (VM e2-micro, Secret Manager) fica obsoleta, e a 034 (compose de produção) se sobrepõe à tarefa do compose.
- O grupo `docker` equivale a root no host. Quem tem a chave de deploy só executa os 3 comandos do `deploy-ssh`, e é isso que limita o risco.
- No host, o uid 1000 é o dono dos arquivos de segredo, porque é o usuário `node` da imagem da API. No Ubuntu, o primeiro usuário criado recebe o uid 1000. Esse usuário tem de ser o administrador, nunca o `deploy`.
- Se a VPS for perdida, o dump externo restaura os dados. As chaves públicas antigas estão em `signing_keys` (ADR 0031), então a verificação continua valendo. Sem cópia do `.env.local`, a nova VPS gera segredos novos, com os efeitos da ADR 0023: os pseudônimos mudam nos lotes abertos e as sessões são renovadas.
- O volume `caddy_data` guarda a conta ACME e os certificados e não pode ser recriado à toa: o Let's Encrypt limita a emissão de certificados idênticos (5 por semana).
