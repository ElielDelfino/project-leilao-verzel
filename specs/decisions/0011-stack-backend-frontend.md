# 0011 — Stack: Node 24 + NestJS 12 + Drizzle + Postgres 18; React 19 + Vite 8

Status: aceita
Data: 2026-10-24

## Decisão
Versões verificadas no npm/Docker Hub em 2026-10-24: Node 24.22 LTS, pnpm 12, NestJS 12.2 + `@nestjs/platform-fastify`, Socket.IO 4.8, `@socket.io/redis-adapter` 8.3, Drizzle ORM 0.45 + drizzle-kit 0.31, Zod 4, argon2, `@noble/ed25519` 3, Postgres 18.6, Redis 8.8, React 19.3, Vite 8, React Router 8, TanStack Query 5, Tailwind 4.3, Vitest 5, Playwright 1.64, k6.

## Alternativas consideradas
- FastAPI: Socket.IO menos integrado; sem tipos compartilhados com o front.
- Fastify puro: sem módulos/DI para impor fronteiras.
- Django/DRF: modelo síncrono e Channels pesam contra a latência.
- Next.js: mais um servidor no deploy, sem ganho real.
- Prisma: locking, triggers e `SKIP LOCKED` exigiriam `$queryRaw` nas partes críticas.

## Consequências
Tipos compartilhados via `packages/contracts`; módulos Nest mapeiam 1:1 para a ADR 0003.
