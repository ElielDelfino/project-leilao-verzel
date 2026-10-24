# 0003 — Monolito modular

Status: aceita
Data: 2026-10-24

## Contexto
Um dev, 5 dias, uma VM. Aceitar um lance precisa, de forma atômica, comprometer o saldo do novo líder, liberar o anterior, anexar à hash chain e aplicar o anti-sniping.

## Decisão
Uma API NestJS com módulos de fronteiras impostas (`eslint-plugin-boundaries`, interfaces públicas que recebem a mesma `tx`) e uma SPA React separada, num monorepo.

Justificativas: (1) do usuário: "1 dev e 1 deploy; fronteiras fortes e explícitas evitam a bola de lama"; (2) técnica: a regra do lance cabe numa transação ACID local, enquanto serviços separados exigiriam uma saga com compensações e saltos de rede.

## Alternativas consideradas
- Serviços separados: transações distribuídas entre lances e carteira; "microservice premium" (Fowler, 2015) incompatível com o prazo.
- Next.js fullstack: conexões longas e job de 1 s desconfortáveis em runtime serverless.

## Consequências
Fronteiras verificadas no lint; um módulo pode virar serviço no futuro trocando a implementação da interface. Fontes: Fowler, MonolithFirst e MicroservicePremium (2015); Shopify, "Deconstructing the Monolith" (2019); microservices.io/patterns/data/saga.
