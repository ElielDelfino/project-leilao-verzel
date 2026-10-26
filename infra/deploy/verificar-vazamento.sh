#!/bin/bash
# Verificação de vazamento do deploy (task 131; specs/014 §Verificação de vazamento). Chamado pelo
# deploy-ssh depois do health check; instalado ao lado dele em /opt/leilao/bin (root:root, 755).
#   API_IMAGE=<imagem da api> WEB_IMAGE=<imagem da web> verificar-vazamento.sh <diretório da release>
# O diretório da release tem .env, infra/prod.env e infra/docker-compose.prod.yml: o compose usa os
# mesmos -p, --env-file e -f do deploy.
#
# Para cada arquivo de /run/leilao/secrets, o valor só é usado como padrão de
# `grep -qF -f /run/leilao/secrets/<nome>` (nunca entra num argv), aplicado à saída de:
#   1. docker inspect dos containers do projeto (docker compose -p leilao-prod ps -aq);
#   2. docker compose config (modelo completo, sem --quiet);
#   3. docker history --no-trunc das imagens da API e da web;
#   4. ps -eww -o args= no host;
#   5. journalctl -u da unidade de materialização (leilao-segredos.service).
# O usuário `deploy` não lê /run/leilao/secrets (700 root), então o grep roda num container
# auxiliar da imagem da API, sem rede, só leitura e sem capabilities, que monta cada arquivo como o
# uid dono (1000). As saídas só passam pelo pipe até o `grep -q` (nada vai para terminal, arquivo
# ou log), e o script não usa `set -x` nem ecoa variáveis. Relata só o nome do segredo e da fonte.
#
# Saída: 0 sem ocorrência ("nenhum segredo nas saídas do Docker"); 1 com qualquer ocorrência; 2 se
# uma fonte ou o grep falhar (falha fechada: uma fonte vazia por erro não passa como limpa),
# inclusive com o journal da unidade vazio ou ilegível (o `deploy` precisa do grupo
# systemd-journal; docs/deploy.md §Instalação na VPS e no GitHub).
#
# Variáveis só para os testes: LEILAO_SECRETS_DIR (padrão /run/leilao/secrets), LEILAO_SECRETS_UID
# (padrão 1000) e LEILAO_UNIDADE_SEGREDOS (padrão leilao-segredos.service).
set -euo pipefail
umask 077

readonly PROJETO=leilao-prod
readonly SEGREDOS="${LEILAO_SECRETS_DIR:-/run/leilao/secrets}"
readonly DONO="${LEILAO_SECRETS_UID:-1000}"
readonly UNIDADE="${LEILAO_UNIDADE_SEGREDOS:-leilao-segredos.service}"
readonly NOMES=(db_password db_api_password redis_password jwt_secret pseudonym_hmac_key
  ed25519_private_key)

erro() {
  printf 'verificar-vazamento: %s\n' "$1" >&2
  exit 2
}

[[ $# -eq 1 ]] || erro "uso: API_IMAGE=... WEB_IMAGE=... $0 <diretório da release>"
readonly RELEASE=$1
[[ -n ${API_IMAGE-} && -n ${WEB_IMAGE-} ]] || erro "API_IMAGE e WEB_IMAGE são obrigatórias"
for arquivo in .env infra/prod.env infra/docker-compose.prod.yml; do
  [[ -f $RELEASE/$arquivo ]] || erro "$RELEASE/$arquivo não existe"
done

compose() {
  docker compose -p "$PROJETO" --env-file "$RELEASE/.env" --env-file "$RELEASE/infra/prod.env" \
    -f "$RELEASE/infra/docker-compose.prod.yml" "$@" </dev/null
}

# ---------------------------------------------------------------- fontes

CONTAINERS=()
lista="$(compose ps -aq)" || erro "docker compose ps falhou"
[[ -n $lista ]] || erro "nenhum container do projeto $PROJETO"
mapfile -t CONTAINERS <<<"$lista"

fonte_inspect() { docker inspect "${CONTAINERS[@]}"; }
fonte_config() { compose config; }
fonte_history_api() { docker history --no-trunc "$API_IMAGE"; }
fonte_history_web() { docker history --no-trunc "$WEB_IMAGE"; }
fonte_ps() { ps -eww -o args=; }
fonte_journal() { journalctl -u "$UNIDADE" --no-pager --quiet; }

# Sem nenhuma linha visível, o journal ilegível passaria por limpo.
set +e
# (--lines tem argumento opcional: só aceita a forma com `=`.)
journalctl -u "$UNIDADE" --no-pager --quiet --lines=1 2>/dev/null | grep -q .
estados=("${PIPESTATUS[@]}")
set -e
[[ ${estados[1]} -eq 0 ]] ||
  erro "o journal de $UNIDADE está vazio ou ilegível para este usuário (grupo systemd-journal?)"

# ---------------------------------------------------------------- container auxiliar

AUXILIAR="leilao-vazamento-$$"
remover_auxiliar() { docker rm -f "$AUXILIAR" >/dev/null 2>&1 || true; }
trap remover_auxiliar EXIT

montagens=()
for nome in "${NOMES[@]}"; do
  montagens+=(--mount "type=bind,src=$SEGREDOS/$nome,dst=$SEGREDOS/$nome,readonly")
done
docker run -d --rm --name "$AUXILIAR" --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges --user "$DONO:$DONO" --pids-limit 16 --memory 32m \
  "${montagens[@]}" --entrypoint sleep "$API_IMAGE" 600 >/dev/null </dev/null ||
  erro "não consegui iniciar o container auxiliar (faltam arquivos em $SEGREDOS?)"

# ---------------------------------------------------------------- verificação

ACHADOS=0
verificar() {
  local rotulo=$1 fonte=$2 nome
  local -a estados
  for nome in "${NOMES[@]}"; do
    set +e
    "$fonte" 2>/dev/null | docker exec -i "$AUXILIAR" grep -qF -f "$SEGREDOS/$nome"
    estados=("${PIPESTATUS[@]}")
    set -e
    case ${estados[1]} in
      0)
        printf 'verificar-vazamento: %s: %s\n' "$nome" "$rotulo"
        ACHADOS=$((ACHADOS + 1))
        ;;
      1) [[ ${estados[0]} -eq 0 ]] || erro "a fonte \"$rotulo\" falhou (saída ${estados[0]})" ;;
      *) erro "o grep de $nome em \"$rotulo\" falhou (saída ${estados[1]})" ;;
    esac
  done
}

verificar 'docker inspect' fonte_inspect
verificar 'docker compose config' fonte_config
verificar 'docker history (api)' fonte_history_api
verificar 'docker history (web)' fonte_history_web
verificar 'ps -eww' fonte_ps
verificar "journalctl -u $UNIDADE" fonte_journal

if [[ $ACHADOS -gt 0 ]]; then
  printf 'verificar-vazamento: %d ocorrência(s); o deploy falha\n' "$ACHADOS" >&2
  exit 1
fi
printf 'verificar-vazamento: nenhum segredo nas saídas do Docker\n'
