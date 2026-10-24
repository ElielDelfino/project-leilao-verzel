# Imagem da API (specs/014 §Produção, ADR 0013). Contexto de build: raiz do repositório.
#   docker build -f apps/api/Dockerfile -t leilao-api:<versão>-alpine .
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
COPY        apps/api/ apps/api/
RUN         ["pnpm", "--filter", "@leilao/api", "run", "build"]
# Diretório autônomo só com as dependências de produção da API (pnpm.io/cli/deploy). Sem
# --offline: a checagem de supply-chain do pnpm 12 consulta os metadados do registry.
RUN         ["pnpm", "--filter", "@leilao/api", "deploy", "--prod", "--ignore-scripts", "/out"]

#------------------------------------------- RUNTIME
FROM        node:24.22.1-alpine3.24 AS runtime
# Atualizações de segurança da base Alpine.
RUN         ["apk", "upgrade", "--no-cache"]
WORKDIR     /app
# Dono root e só leitura para o usuário node: o processo não altera o próprio código.
COPY        --from=build  /out/package.json  ./package.json
COPY        --from=build  /out/node_modules  ./node_modules
COPY        --from=build  /out/dist          ./dist
ENV         NODE_ENV=production \
            API_PORT=13000 \
            LOG_LEVEL=info \
            TMPDIR=/tmp
USER        node
EXPOSE      13000/tcp
STOPSIGNAL  SIGTERM
# /api/health/live: o processo responde. O /api/health/ready (Postgres + Redis) responde 503 até a
# tarefa 017; trocar quando ela entrar. wget é o do busybox da base (sem pacote extra).
HEALTHCHECK \
            --start-interval=1s \
            --start-period=20s \
            --interval=10s \
            --timeout=3s \
            --retries=3 \
            CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:13000/api/health/live"]
CMD         ["node", "dist/main.js"]

LABEL       org.opencontainers.image.title="leilao-api" \
            org.opencontainers.image.description="API da Casa de Leilões (NestJS 12 + Fastify)" \
            org.opencontainers.image.licenses="MIT" \
            org.opencontainers.image.source="https://github.com/ElielDelfino/project-leilao-verzel"
