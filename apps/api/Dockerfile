# Imagem da API (specs/014 §Produção, ADR 0033). Contexto de build: raiz do repositório, mais o
# contexto nomeado `migrations` (database/postgres/migrations, que o .dockerignore da raiz deixa
# de fora):
#   docker build -f apps/api/Dockerfile \
#       --build-context migrations=database/postgres/migrations \
#       -t leilao-api:<versão>-alpine .
# Sem o --build-context, o COPY --from=migrations tenta baixar uma imagem com esse nome e o build
# falha: nunca sai uma imagem sem as migrations. O compose de produção passa o contexto sozinho
# (build.additional_contexts).
# A mesma imagem roda a API (CMD padrão) e os one-shots `migrate` e `seed` do compose de produção
# (node dist/db/migrate.js e node dist/db/seed.js).
# Estágios: pnpm (binário) → deps (só lockfile) → build (tsc + pnpm deploy --prod) → runtime.
# Ordem para o cache: a camada de dependências só é refeita quando o pnpm-lock.yaml muda.

#------------------------------------------- PNPM
# Binário standalone do pnpm 12 (pnpm.io/docker: copiar /opt/pnpm da variante com a mesma libc).
FROM        ghcr.io/pnpm/pnpm:12.15.0-alpine AS pnpm

#------------------------------------------- DEPS
FROM        node:24.22.1-alpine3.24 AS deps
COPY        --from=pnpm  /opt/pnpm  /opt/pnpm
RUN         ["ln", "-s", "/opt/pnpm/pnpm", "/usr/local/bin/pnpm"]
WORKDIR     /repo
# pnpm fetch lê só o lockfile: baixa todos os pacotes para o store (dev incluídos, o build usa tsc).
COPY        pnpm-lock.yaml pnpm-workspace.yaml ./
RUN         ["pnpm", "fetch"]

#------------------------------------------- BUILD
FROM        deps AS build
# Manifestos de todos os pacotes do workspace antes do código: o install só é refeito quando
# um package.json muda. --ignore-scripts: o único build liberado (allowBuilds) é o postinstall do
# lefthook, que instala git hooks e não tem uso numa imagem.
COPY        package.json tsconfig.base.json ./
COPY        apps/api/package.json apps/api/
COPY        apps/web/package.json apps/web/
COPY        packages/contracts/package.json packages/contracts/
RUN         ["pnpm", "install", "--offline", "--frozen-lockfile", "--ignore-scripts"]
# @leilao/contracts: só tipos (import type), lidos pelo tsc no build e apagados do dist/.
COPY        packages/contracts/ packages/contracts/
COPY        apps/api/ apps/api/
RUN         ["pnpm", "--filter", "@leilao/api", "run", "build"]
# Diretório autônomo só com as dependências de produção da API (pnpm.io/cli/deploy). Sem
# --offline: a checagem de supply-chain do pnpm 12 consulta os metadados do registry.
RUN         ["pnpm", "--filter", "@leilao/api", "deploy", "--prod", "--ignore-scripts", "/out"]

#------------------------------------------- RUNTIME
FROM        node:24.22.1-alpine3.24 AS runtime
# Atualizações de segurança da base Alpine.
RUN         ["apk", "upgrade", "--no-cache"]
# Mesmo layout do repositório (/app = raiz): o runner de migrations procura a pasta 4 níveis acima
# de dist/db/ (PASTA_DAS_MIGRATIONS em apps/api/src/db/migrate.ts), isto é, em
# /app/database/postgres/migrations.
WORKDIR     /app/apps/api
# Dono root e só leitura para o usuário node: o processo não altera o próprio código.
COPY        --from=build  /out/package.json  ./package.json
COPY        --from=build  /out/node_modules  ./node_modules
COPY        --from=build  /out/dist          ./dist
# Contrato servido em /api/docs/json (ADR 0036 item 5, specs/014 §Produção). O @fastify/swagger o
# lê de dist/docs/ dois níveis acima (CAMINHO_DO_CONTRATO em apps/api/src/docs/documentacao.ts),
# isto é, /app/apps/api/openapi.yaml; sem ele a API não sobe. Vem do código copiado no build, não
# do /out do pnpm deploy (que só leva o que passa pelo packlist). Origem sem curinga: se o arquivo
# sumir, o COPY falha e nenhuma imagem sai sem o contrato.
COPY        --from=build  /repo/apps/api/openapi.yaml  ./openapi.yaml
# SQL e meta/_journal.json lidos pelo migrator do Drizzle (forward-only, ADR 0001).
COPY        --from=migrations  /  /app/database/postgres/migrations/
ENV         NODE_ENV=production \
            API_PORT=13000 \
            LOG_LEVEL=info \
            TMPDIR=/tmp
# Usuário node da imagem base, por uid:gid numérico (não depende do /etc/passwd).
USER        1000:1000
EXPOSE      13000/tcp
STOPSIGNAL  SIGTERM
# Único lugar do healthcheck da API (o compose não o redefine). Provisório: /api/health/live até a
# tarefa 017; o /api/health/ready (Postgres + Redis) responde 503 até lá, trocar quando ela entrar.
# Forma shell para expandir API_PORT (ENV acima ou o environment do compose); wget é o do busybox.
HEALTHCHECK \
            --start-interval=1s \
            --start-period=20s \
            --interval=10s \
            --timeout=3s \
            --retries=3 \
            CMD wget -q -O /dev/null "http://127.0.0.1:${API_PORT}/api/health/live" || exit 1
CMD         ["node", "dist/main.js"]

LABEL       org.opencontainers.image.title="leilao-api" \
            org.opencontainers.image.description="API da Casa de Leilões (NestJS 12 + Fastify)" \
            org.opencontainers.image.licenses="MIT" \
            org.opencontainers.image.source="https://github.com/ElielDelfino/project-leilao-verzel"
