# 0012 — TypeScript 6.0.x

Status: provisória (revisar quando o `nestjs/typescript-starter` adotar o TypeScript 7)
Data: 2026-10-24

## Contexto
O TypeScript 7.0.2 (compilador nativo) é o `latest` no npm, mas o monorepo do NestJS usa 5.9.3 e o starter oficial `^6.0.2`; o Nest depende de `experimentalDecorators` + `emitDecoratorMetadata`.

## Decisão
Fixar `typescript@~6.0` em todo o monorepo.

## Alternativas consideradas
TS 7: risco de incompatibilidade com decorators/metadata no prazo.

## Consequências
Builds mais lentos que com o TS 7; migração futura simples quando o ecossistema Nest confirmar o suporte.
