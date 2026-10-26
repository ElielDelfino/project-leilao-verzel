# 0018 — Observabilidade enxuta e backup diário

Status: parcialmente substituída por 0033 (sai o alerta de orçamento do GCP; o backup ganha cópia fora da VPS)
Data: 2026-10-24

## Decisão
Logs Pino JSON com requestId e sem PII; `/api/health/live` e `/api/health/ready`; logs do Docker com rotação e 14 dias; uptime check externo gratuito com alerta por e-mail; alerta de orçamento GCP em US$ 1. Backup: `pg_dump` diário, 7 cópias na VM, restore testado no CI.

## Alternativas consideradas
Prometheus/Grafana e tracing: não cabem em 1 GB de RAM. Cópia externa do backup: exige conta de serviço e bucket.

## Consequências
Perda da VM perde os backups (aceitável para a demo; o seed recria o estado inicial).
