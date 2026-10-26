#!/usr/bin/env bash
# Prepara a VPS Hostinger (Ubuntu 24.04) para a Casa de Leilões: ADR 0033 itens 1 e 3, specs/014
# §Servidor. Idempotente: cada passo confere o estado antes de agir, e a segunda execução termina
# com "0 alterações". Pode rodar sobre o que já foi feito à mão.
#
#   sudo ./preparar-vps.sh --dry-run <administrador>   # só imprime o que faria
#   sudo ./preparar-vps.sh <administrador>
#
# <administrador> é o usuário com sudo criado pelo humano: tem de existir, estar no grupo sudo, ter
# uid 1000 (dono dos arquivos de segredo, ADR 0033 §Consequências) e ter chave em
# ~/.ssh/authorized_keys (sem ela, o drop-in do sshd o trancaria para fora).
#
# Faz: Docker Engine + plugin Compose pelo apt oficial da Docker (se ausentes), swap de 2 GB em
# /swapfile, usuário `deploy` fora dos grupos sudo/admin e no grupo `docker`, drop-in do sshd (com
# `sshd -t` antes do reload), UFW, unattended-upgrades só de segurança sem reinício, journald com
# 500 MB e os diretórios /opt/leilao, /opt/leilao/bin e /var/backups/leilao.
#
# Atenção: o grupo `docker` equivale a root (quem fala com o daemon monta / num container). Por isso
# a chave do `deploy` só pode ser instalada com `command="/opt/leilao/bin/deploy-ssh",restrict`
# (tarefa 131), nunca como chave livre. Este script não instala chave nenhuma para o `deploy`.
#
# Variáveis só para os testes (sandbox): LEILAO_VPS_RAIZ prefixa todos os caminhos do sistema e
# dispensa o root; LEILAO_VPS_DONO é o dono esperado "uid:gid" dos arquivos (padrão 0:0).
set -euo pipefail
umask 022

readonly RAIZ="${LEILAO_VPS_RAIZ:-}"
readonly DONO="${LEILAO_VPS_DONO:-0:0}"
AQUI="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly AQUI
readonly UID_DO_ADMIN=1000
readonly USUARIO_DEPLOY=deploy
readonly SWAPFILE=/swapfile
readonly TAMANHO_DO_SWAP=2G
readonly NOME_VALIDO='^[a-z_][a-z0-9_-]{0,31}$'

SECO=0
ADMIN=''
ALTERACOES=0
MUDOU=0
APT_ATUALIZADO=0

uso() {
  printf 'Uso: sudo %s [--dry-run] <administrador>\n' "$0" >&2
  exit 2
}

log() { printf 'preparar-vps: %s\n' "$*"; }
falhar() {
  printf 'preparar-vps: ERRO: %s\n' "$*" >&2
  exit 1
}

# Toda ação que altera o sistema passa por aqui: conta, e no --dry-run só imprime.
mudar() {
  ALTERACOES=$((ALTERACOES + 1))
  if [[ $SECO -eq 1 ]]; then
    log "[dry-run] $*"
    return 0
  fi
  log "executando: $*"
  "$@"
}

# ---------------------------------------------------------------- arquivos e diretórios

# garantir_dono_e_modo <caminho real> <modo octal>
garantir_dono_e_modo() {
  local caminho="$1" modo="$2"
  [[ -e $caminho ]] || return 0
  [[ $(stat -c '%a' -- "$caminho") == "${modo#0}" ]] || mudar chmod "$modo" "$caminho"
  [[ $(stat -c '%u:%g' -- "$caminho") == "$DONO" ]] || mudar chown "$DONO" "$caminho"
}

# garantir_arquivo <caminho no sistema> <modo>; conteúdo pelo stdin. MUDOU=1 se o conteúdo mudou.
garantir_arquivo() {
  local destino="$RAIZ$1" modo="$2" novo
  MUDOU=0
  novo="$(mktemp)"
  cat >"$novo"
  if [[ -L $destino ]]; then
    rm -f -- "$novo"
    falhar "$1 é um link simbólico; remova-o antes"
  fi
  if [[ ! -f $destino ]] || ! cmp -s -- "$novo" "$destino"; then
    MUDOU=1
    mudar install -D -m "$modo" "$novo" "$destino"
  fi
  rm -f -- "$novo"
  garantir_dono_e_modo "$destino" "$modo"
}

# garantir_diretorio <caminho no sistema> <modo>
garantir_diretorio() {
  local destino="$RAIZ$1" modo="$2"
  if [[ -L $destino ]]; then falhar "$1 é um link simbólico; remova-o antes"; fi
  [[ -d $destino ]] || mudar mkdir -p -m "$modo" "$destino"
  garantir_dono_e_modo "$destino" "$modo"
}

# acrescentar_linha <arquivo> <linha>: se o arquivo não termina em \n, põe um antes, para a linha nova
# não colar na última entrada (um /etc/fstab assim pode impedir o boot).
acrescentar_linha() {
  if [[ -s $1 && -n $(tail -c 1 -- "$1") ]]; then printf '\n' >>"$1"; fi
  printf '%s\n' "$2" >>"$1"
}

# com_umask_077 <comando...>: roda o comando num subshell com umask 077 (arquivo nasce 600).
com_umask_077() { (umask 077 && "$@"); }

# ---------------------------------------------------------------- consultas

pacote_instalado() {
  dpkg-query -W -f='${Status}' "$1" 2>/dev/null | grep -q 'install ok installed'
}

# Campo <n> da linha de getent passwd|group <nome>; vazio se não existir.
campo_getent() {
  local base="$1" nome="$2" campo="$3" linha
  linha="$(getent "$base" "$nome" 2>/dev/null || true)"
  [[ -n $linha ]] || return 0
  printf '%s\n' "$linha" | cut -d: -f"$campo"
}

membro_do_grupo() {
  local usuario="$1" grupo="$2"
  campo_getent group "$grupo" 4 | tr ',' '\n' | grep -qx -- "$usuario"
}

instalar_pacotes() {
  if [[ $APT_ATUALIZADO -eq 0 ]]; then
    mudar apt-get update
    APT_ATUALIZADO=1
  fi
  mudar env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "$@"
}

# ---------------------------------------------------------------- passos

verificar_sistema() {
  local release="$RAIZ/etc/os-release"
  [[ -f $release ]] || falhar "/etc/os-release não encontrado"
  grep -qx 'ID=ubuntu' "$release" || falhar "esta VPS não é Ubuntu (ADR 0033 item 1)"
  grep -qx 'VERSION_ID="24.04"' "$release" ||
    log "aviso: a ADR 0033 pede Ubuntu 24.04 LTS; esta versão não foi testada"
}

verificar_administrador() {
  local uid home chaves
  uid="$(campo_getent passwd "$ADMIN" 3)"
  [[ -n $uid ]] || falhar "o usuário $ADMIN não existe; crie-o antes (docs/operacao.md)"
  [[ $uid == "$UID_DO_ADMIN" ]] ||
    falhar "$ADMIN tem uid $uid; o administrador tem de ser o uid $UID_DO_ADMIN (dono dos segredos, ADR 0033)"
  membro_do_grupo "$ADMIN" sudo || falhar "$ADMIN não está no grupo sudo"
  home="$(campo_getent passwd "$ADMIN" 6)"
  chaves="$RAIZ$home/.ssh/authorized_keys"
  [[ -s $chaves ]] ||
    falhar "$home/.ssh/authorized_keys de $ADMIN está vazio ou ausente; sem chave o SSH ficaria trancado"
  log "administrador $ADMIN: uid $uid, grupo sudo, com chave SSH"
}

conflitos_do_docker() {
  local pacote
  for pacote in docker.io docker-compose docker-compose-v2 docker-doc docker-buildx podman-docker \
    containerd runc; do
    if pacote_instalado "$pacote"; then printf '%s ' "$pacote"; fi
  done
}

configurar_docker() {
  if pacote_instalado docker-ce && pacote_instalado docker-compose-plugin; then
    log "Docker Engine e plugin Compose já instalados"
  else
    local conflitos codinome arquitetura
    conflitos="$(conflitos_do_docker)"
    [[ -z $conflitos ]] ||
      falhar "pacotes que conflitam com o Docker oficial: ${conflitos}; remova-os à mão (docs/operacao.md)"
    codinome="$(sed -n 's/^VERSION_CODENAME=//p' "$RAIZ/etc/os-release")"
    [[ $codinome =~ ^[a-z]+$ ]] || falhar "VERSION_CODENAME ausente em /etc/os-release"
    arquitetura="$(dpkg --print-architecture)"
    # Repositório apt oficial: https://docs.docker.com/engine/install/ubuntu/ (sem o buildx, porque
    # a VPS nunca constrói imagem, ADR 0033 item 5.1).
    instalar_pacotes ca-certificates curl
    garantir_diretorio /etc/apt/keyrings 755
    mudar curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o "$RAIZ/etc/apt/keyrings/docker.asc"
    garantir_dono_e_modo "$RAIZ/etc/apt/keyrings/docker.asc" 644
    garantir_arquivo /etc/apt/sources.list.d/docker.sources 644 <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $codinome
Components: stable
Architectures: $arquitetura
Signed-By: /etc/apt/keyrings/docker.asc
EOF
    APT_ATUALIZADO=0
    instalar_pacotes docker-ce docker-ce-cli containerd.io docker-compose-plugin
  fi
  [[ $(systemctl is-enabled docker.service 2>/dev/null || true) == enabled ]] ||
    mudar systemctl enable --now docker.service
}

configurar_swap() {
  local arquivo="$RAIZ$SWAPFILE"
  if awk -v p="$SWAPFILE" '$1 == p { achou = 1 } END { exit !achou }' "$RAIZ/proc/swaps"; then
    log "swap $SWAPFILE já ativo"
  elif [[ -e $arquivo ]]; then
    log "$SWAPFILE existe mas não está ativo: ativando"
    mudar swapon "$arquivo"
  else
    mudar com_umask_077 fallocate -l "$TAMANHO_DO_SWAP" "$arquivo"
    mudar chmod 600 "$arquivo"
    mudar mkswap "$arquivo"
    mudar swapon "$arquivo"
  fi
  garantir_dono_e_modo "$arquivo" 600
  local fstab="$RAIZ/etc/fstab" linha
  linha="$(grep -E "^${SWAPFILE}[[:space:]]" "$fstab" || true)"
  if [[ -z $linha ]]; then
    # Cópia com data antes de mexer no fstab; nofail: um swap ausente não trava o boot.
    mudar cp -p -- "$fstab" "$fstab.antes-leilao-$(date -u +%Y%m%dT%H%M%SZ)"
    mudar acrescentar_linha "$fstab" "$SWAPFILE none swap sw,nofail 0 0"
  elif [[ $linha != *nofail* ]]; then
    log "aviso: a linha do $SWAPFILE no /etc/fstab não tem nofail; acrescente-a à mão (docs/operacao.md)"
  fi
}

configurar_deploy() {
  local uid grupo
  uid="$(campo_getent passwd "$USUARIO_DEPLOY" 3)"
  if [[ -z $uid ]]; then
    # Shell de login válido: o sshd executa o comando forçado (tarefa 131) pelo shell do usuário.
    mudar useradd --create-home --shell /bin/bash "$USUARIO_DEPLOY"
  elif [[ $uid == "$UID_DO_ADMIN" ]]; then
    falhar "$USUARIO_DEPLOY tem uid $UID_DO_ADMIN, que é do administrador (ADR 0033 §Consequências)"
  fi
  if [[ -z $(campo_getent group docker 1) ]]; then
    [[ $SECO -eq 1 ]] || falhar "o grupo docker não existe (o pacote docker-ce o cria)"
    log "[dry-run] o grupo docker ainda não existe; o $USUARIO_DEPLOY entraria nele depois do Docker"
    ALTERACOES=$((ALTERACOES + 1))
  elif ! membro_do_grupo "$USUARIO_DEPLOY" docker; then
    mudar usermod -aG docker "$USUARIO_DEPLOY"
  fi
  for grupo in sudo admin; do
    if membro_do_grupo "$USUARIO_DEPLOY" "$grupo"; then
      mudar gpasswd -d "$USUARIO_DEPLOY" "$grupo"
    fi
  done
}

configurar_sshd() {
  local destino=/etc/ssh/sshd_config.d/00-leilao.conf anterior=''
  if [[ -f $RAIZ$destino ]]; then
    anterior="$(mktemp)"
    cp -p -- "$RAIZ$destino" "$anterior"
  fi
  # Redireção, não pipe: garantir_arquivo precisa rodar neste shell (MUDOU, ALTERACOES, falhar).
  garantir_arquivo "$destino" 644 < <(sed "s/@ADMIN@/$ADMIN/g" "$AQUI/sshd/00-leilao.conf")
  if [[ $MUDOU -eq 1 && $SECO -eq 0 ]]; then
    if ! sshd -t; then
      if [[ -n $anterior ]]; then cp -p -- "$anterior" "$RAIZ$destino"; else rm -f -- "$RAIZ$destino"; fi
      rm -f -- "$anterior"
      falhar "sshd -t recusou a configuração; o drop-in anterior foi restaurado e o sshd não foi recarregado"
    fi
    # Ubuntu 24.04 ativa o ssh pelo ssh.socket: recarrega se o serviço estiver rodando; senão, a
    # próxima conexão já sobe com a configuração nova. Sessões abertas não caem.
    mudar systemctl try-reload-or-restart ssh.service
  elif [[ $MUDOU -eq 0 ]]; then
    log "drop-in do sshd já atualizado"
  fi
  [[ -z $anterior ]] || rm -f -- "$anterior"
}

configurar_ufw() {
  local padrao="$RAIZ/etc/default/ufw" estado regras regra ipv6_mudou=0
  if ! command -v ufw >/dev/null 2>&1; then
    instalar_pacotes ufw
    if [[ $SECO -eq 1 ]]; then
      log "[dry-run] depois de instalar o ufw: deny incoming, limit 22/tcp, allow 80/tcp e 443/tcp, enable"
      return 0
    fi
  fi
  if ! grep -qx 'IPV6=yes' "$padrao" 2>/dev/null; then
    ipv6_mudou=1
    if grep -q '^IPV6=' "$padrao" 2>/dev/null; then
      mudar sed -i 's/^IPV6=.*/IPV6=yes/' "$padrao"
    else
      mudar acrescentar_linha "$padrao" 'IPV6=yes'
    fi
  fi
  estado="$(ufw status verbose)"
  regras="$(ufw show added)"
  grep -q 'deny (incoming)' <<<"$estado" || mudar ufw default deny incoming
  grep -q 'allow (outgoing)' <<<"$estado" || mudar ufw default allow outgoing
  for regra in 'limit 22/tcp' 'allow 80/tcp' 'allow 443/tcp'; do
    # shellcheck disable=SC2086 # a regra é dividida em palavras de propósito
    grep -qx "ufw $regra" <<<"$regras" || mudar ufw $regra
  done
  if grep -q '^Status: active' <<<"$estado"; then
    [[ $ipv6_mudou -eq 0 ]] || mudar ufw reload
  else
    mudar ufw --force enable
  fi
  while IFS= read -r regra; do
    case "$regra" in
      'ufw limit 22/tcp' | 'ufw allow 80/tcp' | 'ufw allow 443/tcp') ;;
      'ufw '*) log "aviso: regra extra no UFW, fora da specs/014: '$regra' (remova com ufw delete)" ;;
    esac
  done <<<"$regras"
}

configurar_atualizacoes() {
  pacote_instalado unattended-upgrades || instalar_pacotes unattended-upgrades
  garantir_arquivo /etc/apt/apt.conf.d/21leilao-auto-upgrades 644 <"$AQUI/apt/21leilao-auto-upgrades"
  garantir_arquivo /etc/apt/apt.conf.d/52leilao-unattended-upgrades 644 \
    <"$AQUI/apt/52leilao-unattended-upgrades"
}

configurar_journald() {
  garantir_arquivo /etc/systemd/journald.conf.d/00-leilao.conf 644 <"$AQUI/journald/00-leilao.conf"
  [[ $MUDOU -eq 0 ]] || mudar systemctl restart systemd-journald.service
}

configurar_diretorios() {
  garantir_diretorio /opt/leilao 755
  garantir_diretorio /opt/leilao/bin 755
  garantir_diretorio /var/backups/leilao 700
}

# ---------------------------------------------------------------- principal

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) SECO=1 ;;
    -h | --help) uso ;;
    -*) uso ;;
    *)
      [[ -z $ADMIN ]] || uso
      ADMIN="$1"
      ;;
  esac
  shift
done
[[ -n $ADMIN ]] || uso
[[ $ADMIN =~ $NOME_VALIDO ]] || falhar "nome de administrador inválido"
[[ $ADMIN != root && $ADMIN != "$USUARIO_DEPLOY" ]] ||
  falhar "o administrador não pode ser root nem $USUARIO_DEPLOY"
if [[ -z $RAIZ && $EUID -ne 0 ]]; then falhar "rode com sudo"; fi
[[ $SECO -eq 0 ]] || log "modo --dry-run: nada será alterado"

verificar_sistema
verificar_administrador
configurar_docker
configurar_swap
configurar_deploy
configurar_sshd
configurar_ufw
configurar_atualizacoes
configurar_journald
configurar_diretorios

if [[ -e $RAIZ/var/run/reboot-required ]]; then
  log "aviso: /var/run/reboot-required existe; reinicie fora de leilão ao vivo (docs/operacao.md)"
fi
if [[ $SECO -eq 1 ]]; then
  log "dry-run concluído: $ALTERACOES alterações seriam feitas"
else
  log "concluído: $ALTERACOES alterações"
fi
