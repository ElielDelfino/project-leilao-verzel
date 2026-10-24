# 0013 — Deploy na GCP e2-micro (Always Free) com Docker Compose

Status: aceita
Data: 2026-10-24

## Contexto
O deploy é obrigatório e o custo deve ser zero (conta sem trial de US$ 300 confirmado). Fatos verificados em docs.cloud.google.com em 2026-10-24:
- Always Free: 1 e2-micro/mês em us-west1, us-central1 ou us-east1; 30 GB de disco; 1 GB/mês de egress.
- Cloud Run request-based: "CPU is only allocated during request processing"; um WebSocket aberto mantém a instância ativa e cobrada; job em background exige instance-based billing + min-instances.
- Cloud SQL e Memorystore não têm free tier permanente.

## Decisão
e2-micro em us-east1, Debian, Docker Compose (Postgres, Redis, API, Caddy), imagens construídas no CI e publicadas no GHCR (`linux/amd64`), swap de 2 GB, limites de memória por container. Sem staging.

## Alternativas consideradas
- Cloud Run + Firebase Hosting: reabriria as ADRs 0008 e 0010 e teria custo fixo.
- e2-medium (~US$ 25–30/mês) ou Hetzner (~€4/mês): permitiriam as metas rígidas, mas têm custo.

## Consequências
Força as metas de desempenho de demo (ADR 0014); risco de OOM mitigado com limites, swap e k6 contra a VM antes da entrega.
