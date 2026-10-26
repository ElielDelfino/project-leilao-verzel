#!/usr/bin/env bash
# Gera /opt/leilao/.env.local na VPS, uma única vez (specs/014 §Segredos > Produção, ADR 0033 item
# 4.2). É o equivalente em shell do `pnpm keys:generate`, porque a VPS não tem Node nem o
# repositório. Rodar como root: sudo /opt/leilao/bin/gerar-env-local.sh
#
# - Cada um dos 6 segredos são 32 bytes de /dev/urandom em base64url sem padding (43 caracteres).
#   Qualquer sequência de 32 bytes é uma seed Ed25519 válida (RFC 8032 §5.1.5).
# - Os valores só passam por pipes e por builtins do bash (printf, [[ ]]): nunca entram no argv de
#   um processo nem são impressos. A saída lista só o caminho e os nomes.
# - Se o arquivo já existir (inclusive como link simbólico), sai com código 1 sem alterar nada.
# - O arquivo nasce 600 (umask 077) num temporário do mesmo diretório e é publicado com `ln`, que
#   falha se o destino tiver aparecido no meio: nunca sobrescreve.
#
# Variável (para os testes): LEILAO_ENV_LOCAL, caminho do arquivo (padrão /opt/leilao/.env.local).
set -euo pipefail
umask 077

readonly DESTINO="${LEILAO_ENV_LOCAL:-/opt/leilao/.env.local}"
readonly VARIAVEIS=(DB_PASSWORD DB_API_PASSWORD REDIS_PASSWORD JWT_SECRET PSEUDONYM_HMAC_KEY
  ED25519_PRIVATE_KEY)
readonly BYTES_POR_SEGREDO=32
# Forma canônica de specs/014 §Leitura: 43 caracteres base64url; o último carrega 2 bits de
# preenchimento, que têm de ser zero (valor do caractere múltiplo de 4).
readonly FORMA_CANONICA='^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$'

falhar() {
  printf 'gerar-env-local: %s\n' "$1" >&2
  exit 1
}

if [[ $# -gt 0 ]]; then
  printf 'Uso: %s (sem argumentos; destino em LEILAO_ENV_LOCAL)\n' "$0" >&2
  exit 2
fi

[[ $DESTINO == /* ]] || falhar "LEILAO_ENV_LOCAL precisa ser um caminho absoluto"
DIRETORIO="$(dirname -- "$DESTINO")"
readonly DIRETORIO
if [[ -e $DESTINO || -L $DESTINO ]]; then
  falhar "$DESTINO já existe; nada foi alterado. Para trocar um segredo, veja a rotação em docs/operacao.md"
fi
[[ -d $DIRETORIO && ! -L $DIRETORIO ]] ||
  falhar "o diretório $DIRETORIO não existe (rode infra/vps/preparar-vps.sh antes)"

TEMPORARIO="$(mktemp -- "$DIRETORIO/.env.local.tmp.XXXXXXXX")"
readonly TEMPORARIO
trap 'rm -f -- "$TEMPORARIO"' EXIT

# Um valor: bytes do urandom → base64 → alfabeto base64url → sem '=' nem quebra de linha.
segredo_no_stdout() {
  head -c "$BYTES_POR_SEGREDO" /dev/urandom | base64 -w 0 | tr '+/' '-_' | tr -d '=\n'
}

{
  printf '# Segredos de produção da Casa de Leilões (specs/014). NÃO versionar, NÃO copiar, NÃO exibir.\n'
  for nome in "${VARIAVEIS[@]}"; do
    printf '%s=' "$nome"
    segredo_no_stdout
    printf '\n'
  done
} >"$TEMPORARIO"

# Confere o que foi gravado antes de publicar (só builtins: o valor não sai do processo).
declare -A vistos=()
while IFS= read -r linha; do
  [[ $linha == '#'* ]] && continue
  nome="${linha%%=*}"
  [[ $linha =~ ^[A-Z0-9_]+=(.*)$ && ${BASH_REMATCH[1]} =~ $FORMA_CANONICA ]] ||
    falhar "$nome gerado fora da forma canônica; nada foi gravado"
  vistos[$nome]=1
done <"$TEMPORARIO"
for nome in "${VARIAVEIS[@]}"; do
  [[ -n ${vistos[$nome]:-} ]] || falhar "$nome não foi gerado; nada foi gravado"
done

chmod 600 -- "$TEMPORARIO"
ln -- "$TEMPORARIO" "$DESTINO" 2>/dev/null ||
  falhar "$DESTINO apareceu durante a geração; nada foi alterado"

printf 'gerar-env-local: %s criado (permissão 600) com:\n' "$DESTINO"
printf '  - %s\n' "${VARIAVEIS[@]}"
printf 'Próximo passo: sudo /opt/leilao/bin/materializar-segredos.sh\n'
