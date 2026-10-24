# Histórico de decisões

Índice das ADRs. Consulte antes de propor mudanças de stack, arquitetura ou processo. Uma decisão aceita só é reaberta diante de um fato novo, com uma nova ADR que a substitua.

| ADR | Título | Status | Conteúdo |
|---|---|---|---|
| [0001](0001-decisoes-iniciais.md) | Decisões iniciais | aceita | idioma, centavos, UUIDv7, anti-sniping = agora+2 min, prazo, LGPD, MIT, SemVer, migrations, lint, segurança, retenção |
| [0002](0002-api-externa-scryfall.md) | API externa: Scryfall | aceita | escolha da Scryfall e comparativo das APIs testadas |
| [0003](0003-monolito-modular.md) | Monolito modular | aceita | arquitetura e justificativa pela transação do lance |
| [0004](0004-tempo-real-socketio-e-lance-rest.md) | Socket.IO + lance REST | aceita | transporte de tempo real |
| [0005](0005-integridade-hash-chain-ed25519.md) | Hash chain + Ed25519 + selo | aceita | técnica antiadulteração e limitações |
| [0006](0006-autenticacao-jwt-cookies.md) | Autenticação JWT em cookies | aceita | auth, papéis, CSRF, seed |
| [0007](0007-carteira-ledger-append-only.md) | Carteira como ledger | aceita | modelo de saldo |
| [0008](0008-encerramento-por-varredura.md) | Encerramento por varredura | aceita | job de 1 s com SKIP LOCKED |
| [0009](0009-imagens-em-bytea.md) | Imagens em bytea | aceita | snapshot das imagens |
| [0010](0010-redis.md) | Redis 8 | aceita | pub/sub, rate limit, cache |
| [0011](0011-stack-backend-frontend.md) | Stack | aceita | versões verificadas |
| [0012](0012-typescript-6.md) | TypeScript 6.0.x | provisória | revisar quando o Nest adotar o TS 7 |
| [0013](0013-deploy-gcp-e2-micro.md) | Deploy GCP e2-micro | aceita | infra de produção e alternativas descartadas |
| [0014](0014-rnfs-de-demo.md) | RNFs de demo | provisória | metas rebaixadas; revisar se sair da e2-micro |
| [0015](0015-segredos-gcp-secret-manager.md) | Secret Manager | aceita | gestão de segredos |
| [0016](0016-testes-dois-niveis.md) | Testes e verify | aceita | pirâmide e dois níveis |
| [0017](0017-ci-cd-github-actions.md) | CI/CD | aceita | pipeline e rollback |
| [0018](0018-observabilidade-e-backup.md) | Observabilidade e backup | aceita | logs, health, uptime, pg_dump |
| [0019](0019-organizacao-agentes-e-git.md) | Organização e Git | aceita | papéis, worktrees, PR |
| [0020](0020-host-publico-e-uptime.md) | Host público e uptime | provisória | sslip.io + UptimeRobot; revisar na tarefa 008 |
| [0021](0021-orquestracao-e-agentes-executores.md) | Orquestrador e agentes executores | aceita | hub-and-spoke, três camadas (frontmatter, gates, hook), opus, revisão pelos globais |
| [0022](0022-complementos-auth-e-idempotencia.md) | Complementos de auth e idempotência | aceita | complementa a 0006: refresh_token em Path=/api/auth, GET /api/auth/csrf, PAPEL_NAO_PERMITIDO, rate limit do cadastro, Idempotency-Key com corpo diferente → 422 |
| [0023](0023-segredos-em-arquivo-e-formatos.md) | Segredos em arquivo e formatos | proposta | substitui a 0015 quando aceita: segredos em arquivo (`*_FILE`) em produção, formatos base64url de 32 bytes, `keyId` derivado da chave pública, `SEED_DEMO_PASSWORD` fixa no `.env` |
