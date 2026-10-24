# 0015 — Segredos no GCP Secret Manager

Status: aceita
Data: 2026-10-24

## Contexto
Escolha do usuário. Preços verificados em cloud.google.com/secret-manager/pricing em 2026-10-24: 6 versões ativas grátis/mês, 10.000 acessos grátis/mês; acima disso US$ 0,000082192/h por versão e US$ 0,03 por 10 mil acessos.

## Decisão
5 segredos (`DB_PASSWORD`, `REDIS_PASSWORD`, `JWT_SECRET`, `ED25519_PRIVATE_KEY`, `PSEUDONYM_HMAC_KEY`), lidos só no deploy pela conta de serviço da VM (`secretAccessor`, sem chave JSON) e gravados em `/run/leilao/secrets.env` (tmpfs, 600). Rotação destrói a versão anterior. Dev: `.env.local` via `pnpm keys:generate`; CI: GitHub Secrets. `.env` versionado só com defaults não sensíveis; segredos no padrão `${VAR:?}`.

## Alternativas consideradas
`.env.prod` com permissão 600 na VM: mais simples, sem dependência do GCP.

## Consequências
Exige configurar a conta de serviço na VM; ultrapassar 6 versões ativas gera custo (alerta de orçamento em US$ 1).
