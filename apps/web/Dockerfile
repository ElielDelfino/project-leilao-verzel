# Imagem da web: Caddy 2.11.7 com a SPA buildada embutida (specs/014 §Produção). Contexto de
# build: raiz do repositório (usa infra/caddy/Caddyfile).
#   docker build -f apps/web/Dockerfile -t leilao-web:<versão>-alpine .
# Estágios: pnpm (binário) → deps (só lockfile) → build (tsc + vite build) → runtime (Caddy).
# Os estágios deps e o início do build são iguais aos de apps/api/Dockerfile: o BuildKit reaproveita
# as camadas entre as duas imagens.

#------------------------------------------- PNPM
FROM        ghcr.io/pnpm/pnpm:12.15.0-alpine AS pnpm

#------------------------------------------- DEPS
FROM        node:24.22.1-alpine3.24 AS deps
COPY        --from=pnpm  /opt/pnpm  /opt/pnpm
RUN         ["ln", "-s", "/opt/pnpm/pnpm", "/usr/local/bin/pnpm"]
WORKDIR     /repo
COPY        pnpm-lock.yaml pnpm-workspace.yaml ./
RUN         ["pnpm", "fetch"]

#------------------------------------------- BUILD
FROM        deps AS build
COPY        package.json tsconfig.base.json ./
COPY        apps/api/package.json apps/api/
COPY        apps/web/package.json apps/web/
COPY        packages/contracts/package.json packages/contracts/
RUN         ["pnpm", "install", "--offline", "--frozen-lockfile", "--ignore-scripts"]
COPY        apps/web/ apps/web/
# tsc --noEmit && vite build: gera apps/web/dist.
RUN         ["pnpm", "--filter", "@leilao/web", "run", "build"]

#------------------------------------------- RUNTIME
FROM        caddy:2.11.7-alpine AS runtime
# Atualizações de segurança da base e usuário sem privilégios. O Caddy escuta 80/443 sem
# capability: o compose define net.ipv4.ip_unprivileged_port_start=0 (sysctl do namespace de rede
# do contêiner). O binário da imagem oficial tem a file capability cap_net_bind_service; com
# cap_drop ALL + no-new-privileges o exec dele falha (EPERM), então ele é recopiado sem o xattr
# (o cp do busybox não preserva xattrs). /data (certificados, volume) fica com o usuário caddy; o
# volume novo herda o dono.
RUN         ["/bin/sh", "-c", "set -eu; apk upgrade --no-cache; cp /usr/bin/caddy /usr/bin/caddy.sem-cap; mv -f /usr/bin/caddy.sem-cap /usr/bin/caddy; chown root:root /usr/bin/caddy; chmod 0755 /usr/bin/caddy; addgroup -S -g 10001 caddy; adduser -S -D -H -u 10001 -G caddy -s /sbin/nologin caddy; chown -R caddy:caddy /data /config; chmod 0700 /data/caddy /config/caddy"]
COPY        infra/caddy/Caddyfile  /etc/caddy/Caddyfile
COPY        --from=build  /repo/apps/web/dist/  /srv/
USER        caddy
EXPOSE      80/tcp
EXPOSE      443/tcp
STOPSIGNAL  SIGTERM
# Site interno http://127.0.0.1:2020/saude do Caddyfile; wget é o do busybox da base.
HEALTHCHECK \
            --start-interval=1s \
            --start-period=20s \
            --interval=10s \
            --timeout=3s \
            --retries=3 \
            CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:2020/saude"]
CMD         ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]

LABEL       org.opencontainers.image.title="leilao-web" \
            org.opencontainers.image.description="SPA da Casa de Leilões servida pelo Caddy 2.11.7" \
            org.opencontainers.image.licenses="MIT" \
            org.opencontainers.image.source="https://github.com/ElielDelfino/project-leilao-verzel"
