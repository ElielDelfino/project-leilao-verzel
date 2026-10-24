# 0023 — Segredos em arquivo, formatos das chaves e variáveis não secretas

Status: aceita
Data: 2026-10-24
Substitui: ADR 0015 (mantém o Secret Manager e troca a entrega dos segredos)
Decisão: do humano, em 2026-10-24 (tarefa 015), aceitando os itens 1 a 7 como propostos e fixando o valor de `SEED_DEMO_PASSWORD`.

## Contexto
A ADR 0015 manda gravar os 5 segredos em `/run/leilao/secrets.env` e usar `${VAR:?}`. Fatos novos desde então:
- No ciclo 1 da tarefa 002, o humano decidiu que os composes de dev recebem as senhas por Compose `secrets:` em arquivo (`.secrets/`), porque um `env_file` ou `environment:` expõe o valor no `Config.Env` do `docker inspect`. Um `secrets.env` em produção, lido como `env_file`, teria a mesma exposição para os 5 segredos.
- O `pnpm keys:generate` (tarefa 010) gera 7 variáveis, e a ADR 0015 só dá origem a 5: faltam `ED25519_KEY_ID` e `SEED_DEMO_PASSWORD`.
- Os formatos das chaves foram escolhidos pelo infra no script, sem spec. A API, o navegador (verificação da auditoria) e o seed precisam ler os mesmos bytes.
- Testado com Docker Compose 5.5.1 em 2026-10-24: sem o arquivo de um secret, o `up` falha com `bind source path does not exist: <caminho>`; `config --quiet` não detecta a falta (sai 0). Sem o arquivo de `--env-file`, sai 1 com `couldn't find env file: <caminho>`.

## Decisão
1. **Mantido da 0015:** GCP Secret Manager com os mesmos 5 segredos (`DB_PASSWORD`, `REDIS_PASSWORD`, `JWT_SECRET`, `ED25519_PRIVATE_KEY`, `PSEUDONYM_HMAC_KEY`), lidos só no deploy pela conta de serviço da VM (`secretAccessor`, sem chave JSON); rotação destrói a versão anterior; dev em `.env.local` via `pnpm keys:generate`; CI em GitHub Secrets; `.env` versionado sem nenhum segredo.
2. **Entrega em arquivo, em dev e em produção.** O `fetch-secrets.sh` grava um arquivo por segredo em `/run/leilao/secrets/` (tmpfs), e o compose de produção os monta com Compose `secrets:` em `/run/secrets/<nome>`. Nenhum segredo passa por `environment:`, `env_file:`, `command:` nem argumento de build. Sai o `secrets.env` e sai o padrão `${VAR:?}` para segredos.
3. **Leitura pela API (e pelo runner de migrations e pelo seed):** para cada um dos 5 segredos, exatamente uma de `<VAR>` (o valor; dev e CI) ou `<VAR>_FILE` (caminho do arquivo com o valor; produção). As duas juntas, nenhuma das duas, arquivo ilegível ou conteúdo fora do formato fazem o processo não subir, com mensagem que cita só o nome da variável.
4. **Formatos:** os 5 segredos são 32 bytes aleatórios em base64url sem padding (43 caracteres). `ED25519_PRIVATE_KEY` é a seed de 32 bytes da RFC 8032 §5.1.5. `JWT_SECRET` e `PSEUDONYM_HMAC_KEY` são usados como os 32 bytes decodificados. `DB_PASSWORD` e `REDIS_PASSWORD` são usados como o próprio texto de 43 caracteres.
5. **`ED25519_KEY_ID` deixa de ser variável:** a API o deriva da chave pública (16 primeiros caracteres hex minúsculos do SHA-256 dos 32 bytes da chave pública).
6. **`SEED_DEMO_PASSWORD` não é segredo:** valor fixo no `.env` versionado, o mesmo em dev, CI e produção, publicado no README (specs/003 RF-03). Valor: `leilao-demo-2026`.
7. **Reinício da VM:** como `/run` é tmpfs, uma unidade systemd roda o `fetch-secrets.sh` no boot, antes do `docker.service`, para que os containers com `restart: always` encontrem os arquivos.

## Alternativas consideradas
- **Manter `/run/leilao/secrets.env` como `env_file`:** é o modelo da 0015 e o mais simples, mas os 5 valores aparecem no `docker inspect` dos containers, justamente o que a decisão de dev quis evitar.
- **Arquivos só para as senhas do Postgres e do Redis, e o resto como variável:** deixaria a chave privada Ed25519, a mais sensível (ADR 0005), no `Config.Env`.
- **`ED25519_KEY_ID` no `.env` (proposta do infra):** o `.env` é o mesmo em dev e produção, então o id de produção vazaria para o dev (ou seria sobrescrito pelo `.env.local`), e rotacionar a chave exigiria um commit; nada impede que id e chave divirjam.
- **`ED25519_KEY_ID` como sexto segredo:** ocupa a 6ª e última versão gratuita do Secret Manager, e qualquer rotação passaria a gerar custo; o valor nem é secreto.
- **`ED25519_KEY_ID` opcional, conferido com a derivação no boot:** detecta divergência, mas mantém uma variável que só pode ter um valor válido.
- **`SEED_DEMO_PASSWORD` aleatória por ambiente (como gera hoje o script):** em produção, alguém teria de copiá-la para o README a cada deploy; é pública por requisito, então não há o que proteger.
- **`SEED_DEMO_PASSWORD` como variável (não secreta) do GitHub Actions:** tira o valor do repositório, mas cria uma segunda fonte além do README.
- **`*_FILE` também em dev:** um só caminho de código, mas obrigaria a API em dev a ler `.secrets/` para os 5 segredos, e o `.env.local` deixaria de ser a fonte única.

## Consequências
- O `fetch-secrets.sh` grava cada arquivo com dono uid 1000 (usuário `node` da imagem da API) e modo 600, sem quebra de linha; o Postgres e o Redis os leem como root no entrypoint (`DAC_OVERRIDE`, `DAC_READ_SEARCH`). O Compose 5.5.1 ignora `uid`, `gid` e `mode` de secrets com `file:` fora do Swarm (avisa e monta o arquivo em bind somente leitura, com dono e modo do host; testado em 2026-10-24), então o dono vem do host.
- O `scripts/keys-generate.mjs` deixa de gerar `ED25519_KEY_ID` e `SEED_DEMO_PASSWORD` (de 7 para 5 variáveis), e o `.env` ganha `SEED_DEMO_PASSWORD` (tarefa do infra). Um `.env.local` antigo que ainda tenha essas linhas sobrescreve o `.env` em dev e precisa ser limpo.
- A derivação do `keyId` não resolve onde ficam as chaves públicas antigas, que a ADR 0005 manda continuar publicando após uma rotação (pendência de specs/008 para a F3).
- Trocar `PSEUDONYM_HMAC_KEY` muda o pseudônimo de quem já deu lance num lote ainda aberto (specs/008 exige pseudônimo estável dentro do lote); a verificação da cadeia não é afetada, porque o pseudônimo gravado entra no hash.
- Trocar `JWT_SECRET` invalida os access tokens em circulação; o refresh token é opaco e não depende dele, então a SPA renova a sessão sem novo login.
