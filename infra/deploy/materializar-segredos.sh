#!/usr/bin/env bash
# Materializa os 6 segredos de /opt/leilao/.env.local em /run/leilao/secrets/<nome> (specs/014
# §Segredos > Produção, ADR 0033 item 4.3). Roda no boot pela unidade leilao-segredos.service
# (antes do docker.service, porque /run é tmpfs) e à mão depois de uma rotação:
#   sudo /opt/leilao/bin/materializar-segredos.sh
#
# - Confere primeiro as 6 variáveis: se faltar uma, se aparecer duas vezes ou se estiver fora da
#   forma canônica de specs/014 §Leitura (43 caracteres base64url que recodificam igual; um \r ou
#   uma linha quebrada também são recusados), sai com código 1 citando só o nome e sem gravar nada.
# - Grava cada arquivo sem quebra de linha, 600, dono uid 1000 (usuário `node` da imagem da API; o
#   Compose ignora uid e mode de secrets com `file:`), num diretório 700. A troca é atômica
#   (temporário + mv no mesmo diretório). Um container já rodando segue o arquivo antigo até ser
#   recriado (o bind mount fica no inode antigo).
# - Os valores só passam por builtins do bash (read, [[ ]], printf com redirecionamento): nunca
#   entram no argv de um processo nem são impressos. A saída lista só nomes.
#
# Variáveis (para os testes): LEILAO_ENV_LOCAL (padrão /opt/leilao/.env.local), LEILAO_SECRETS_DIR
# (padrão /run/leilao/secrets, o mesmo nome lido pelo infra/docker-compose.prod.yml) e
# LEILAO_SECRETS_UID (padrão 1000).
set -euo pipefail
umask 077

readonly ORIGEM="${LEILAO_ENV_LOCAL:-/opt/leilao/.env.local}"
readonly DESTINO="${LEILAO_SECRETS_DIR:-/run/leilao/secrets}"
readonly DONO="${LEILAO_SECRETS_UID:-1000}"
readonly VARIAVEIS=(DB_PASSWORD DB_API_PASSWORD REDIS_PASSWORD JWT_SECRET PSEUDONYM_HMAC_KEY
  ED25519_PRIVATE_KEY)
# Forma canônica de specs/014 §Leitura: 43 caracteres base64url; o último carrega 2 bits de
# preenchimento, que têm de ser zero (valor do caractere múltiplo de 4). Assim, decodificar dá 32
# bytes e recodificar reproduz o mesmo texto.
readonly FORMA_CANONICA='^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'

falhar() {
  printf 'materializar-segredos: %s\n' "$1" >&2
  exit 1
}

if [[ $# -gt 0 ]]; then
  printf 'Uso: %s (sem argumentos; caminhos em LEILAO_ENV_LOCAL e LEILAO_SECRETS_DIR)\n' "$0" >&2
  exit 2
fi

[[ $ORIGEM == /* && $DESTINO == /* ]] ||
  falhar "LEILAO_ENV_LOCAL e LEILAO_SECRETS_DIR precisam ser caminhos absolutos"
[[ $DONO =~ ^[0-9]+$ ]] || falhar "LEILAO_SECRETS_UID precisa ser um uid numérico"
[[ -f $ORIGEM && ! -L $ORIGEM ]] || falhar "$ORIGEM não existe ou não é um arquivo comum"
[[ -r $ORIGEM ]] || falhar "$ORIGEM não pode ser lido (rode com sudo)"
modo="$(stat -c '%a' -- "$ORIGEM")"
[[ $modo == 600 ]] || falhar "$ORIGEM tem permissão $modo; precisa ser 600 (sudo chmod 600 $ORIGEM)"

# ---------------------------------------------------------------- leitura e validação

declare -A valores=()
declare -A esperadas=()
for nome in "${VARIAVEIS[@]}"; do esperadas[$nome]=1; done

while IFS= read -r linha || [[ -n $linha ]]; do
  [[ -z $linha || $linha == '#'* ]] && continue
  [[ $linha == *=* ]] || continue
  nome="${linha%%=*}"
  [[ -n ${esperadas[$nome]:-} ]] || continue
  [[ -z ${valores[$nome]+definida} ]] || falhar "$nome aparece mais de uma vez em $ORIGEM"
  valores[$nome]="${linha#*=}"
done <"$ORIGEM"

for nome in "${VARIAVEIS[@]}"; do
  [[ -n ${valores[$nome]+definida} ]] || falhar "$nome ausente em $ORIGEM; nada foi gravado"
  [[ ${valores[$nome]} =~ $FORMA_CANONICA ]] ||
    falhar "$nome fora da forma canônica (43 caracteres base64url, sem aspas, espaço nem quebra de linha); nada foi gravado"
done

# ---------------------------------------------------------------- gravação

if [[ -L $DESTINO || (-e $DESTINO && ! -d $DESTINO) ]]; then
  falhar "$DESTINO existe e não é um diretório comum; remova-o antes"
fi
mkdir -p -- "$DESTINO"
chmod 700 -- "$DESTINO"

temporarios=()
limpar() { [[ ${#temporarios[@]} -eq 0 ]] || rm -f -- "${temporarios[@]}"; }
trap limpar EXIT

for nome in "${VARIAVEIS[@]}"; do
  arquivo="${nome,,}"
  temporario="$DESTINO/.$arquivo.tmp.$$"
  temporarios+=("$temporario")
  rm -f -- "$temporario"
  printf '%s' "${valores[$nome]}" >"$temporario"
  chmod 600 -- "$temporario"
  chown -- "$DONO" "$temporario"
  mv -f -T -- "$temporario" "$DESTINO/$arquivo"
  printf 'materializar-segredos: %s gravado\n' "$arquivo"
done

printf 'materializar-segredos: 6 arquivos em %s (diretório 700, arquivos 600, dono uid %s)\n' \
  "$DESTINO" "$DONO"
