# Variáveis de ambiente

Fonte: specs/014 §Segredos e ADR 0015. Este documento lista nomes, formatos e usos; **nunca coloque valores aqui**.

## Onde cada grupo vive

| Grupo | Dev | CI | Produção |
|---|---|---|---|
| Defaults não sensíveis (portas, imagens, limites) | `.env` (versionado) | `.env` | `.env` |
| Segredos | `.env.local` (fora do Git), criado por `pnpm keys:generate` | GitHub Secrets | GCP Secret Manager → `/run/leilao/secrets.env` (tmpfs, 600) |

Os composes usam `${VAR:?}` para os segredos: sem o valor, o `docker compose` falha em vez de subir com senha vazia. A infra local sobe com `pnpm infra:up` (= `docker compose --env-file .env --env-file .env.local up -d`).

## Segredos (`.env.local`)

| Variável | Formato gerado | Usado por | Produção |
|---|---|---|---|
| `DB_PASSWORD` | 32 bytes aleatórios, base64url (43 caracteres) | Postgres (`POSTGRES_PASSWORD`) e API | Secret Manager |
| `REDIS_PASSWORD` | 32 bytes aleatórios, base64url | Redis (`--requirepass`) e API | Secret Manager |
| `JWT_SECRET` | 256 bits aleatórios, base64url | API: assinatura HS256 do access token (specs/003) | Secret Manager |
| `PSEUDONYM_HMAC_KEY` | 256 bits aleatórios, base64url | API: pseudônimo HMAC-SHA256 do licitante (specs/008) | Secret Manager |
| `ED25519_PRIVATE_KEY` | chave secreta Ed25519 de 32 bytes (seed RFC 8032, gerada com `@noble/ed25519`), base64url | API: assinatura dos lances e do selo (specs/008) | Secret Manager |
| `ED25519_KEY_ID` | 16 caracteres hex: início do SHA-256 da chave pública | API: coluna `key_id` e `GET /api/auditoria/chaves` (specs/008) | a definir (não é segredo) |
| `SEED_DEMO_PASSWORD` | 15 bytes aleatórios, base64url (20 caracteres; regra de 10 a 128 de specs/003) | seed das contas demo (specs/003 RF-03) | a definir (publicada no README) |

Base64url (RFC 4648 §5) usa só `A–Z a–z 0–9 - _`, então nenhum valor precisa de aspas no `.env` nem de escape no compose ou numa URL de conexão.

A chave pública não é gravada: a API a deriva de `ED25519_PRIVATE_KEY`.

## `pnpm keys:generate`

- Cria `.env.local` na raiz do repositório com permissão 600.
- Se o arquivo já existe, não altera nada e sai com código 0. Para regerar todos os segredos: `pnpm keys:generate --force`.
- Com `--force`, o arquivo anterior é guardado antes da troca em `.env.bak-<data-hora UTC>-<sufixo>.local` (permissão 600, no mesmo diretório). O nome casa com o padrão `.env.*.local` do `.gitignore`. A saída cita o caminho do backup, nunca os valores. Os backups não são apagados automaticamente: apague-os quando não precisar mais da chave antiga.
- Nunca imprime valores: a saída lista só nomes de variáveis e caminhos.
- A gravação é atômica (arquivo temporário `.env.tmp-<pid>-<nome>.local` + `link`/`rename`): uma falha no meio não deixa um `.env.local` incompleto.
- Recusa, sem gravar nada, um destino que o git versionaria: o alvo, o temporário ou o backup dentro de uma working tree sem estar no `.gitignore`, ou um arquivo já rastreado. Também recusa link simbólico (mesmo pendente), diretório e diretório de destino inexistente.
- `--out <caminho>` grava em outro arquivo, só fora do repositório ou em caminho ignorado pelo git; existe para os testes (`pnpm test:scripts`).

Ao regerar com `--force`, o Postgres continua com a senha antiga: ele só lê `POSTGRES_PASSWORD` ao inicializar o volume. Recrie o volume local (`docker compose down -v`, apaga os dados de dev) ou troque a senha no banco antes de subir de novo. Trocar `ED25519_PRIVATE_KEY` invalida a verificação dos lances já assinados com a chave anterior, a menos que a chave pública antiga continue publicada (ADR 0005, rotação por `key_id`); a chave antiga só fica no backup.
