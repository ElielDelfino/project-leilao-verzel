# 0020 — Host público e uptime check

Status: substituída por 0033 (host em DuckDNS; o UptimeRobot continua)
Data: 2026-10-24

## Contexto
O deploy precisa de um host com HTTPS e de um uptime check com alerta, sem custo. Nenhum domínio próprio foi informado.

## Decisão
- Host: `<ip-com-hifens>.sslip.io` apontando para o IP estático da VM; Caddy emite o certificado automaticamente.
- Uptime: plano gratuito do UptimeRobot monitorando `/api/health/ready`, com alerta por e-mail. Os limites do plano gratuito devem ser verificados na tarefa 008.

## Alternativas consideradas
- Domínio próprio: custo e prazo de propagação.
- GCP Uptime Checks: exige configuração de Monitoring e pode sair do free tier.

## Consequências
URL pouco amigável na entrega; trocar para um domínio próprio é só DNS + Caddyfile.
