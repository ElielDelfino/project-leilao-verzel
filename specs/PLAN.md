# Plano de implementação

Prazo final: **2026-10-29 23:59**. Risco de prazo aceito sem plano de corte (ADR 0001); a mitigação é paralelizar por papel e fazer o deploy assim que a VPS existir. O deploy saiu da F0 com a troca do GCP pela VPS (ADR 0033) e entra na F5 (tarefas do infra a partir da 129).

## F0 — Fundação e walking skeleton (24–25/10)
- **Objetivo:** monorepo, tooling, infra local, verificação, CI e um esqueleto (API com health + SPA). A publicação na VM saiu da F0 e foi para a F5 (ADR 0033).
- **Specs:** 001, 002, 013, 014.
- **Depende de:** —
- **Paralelo:** depois da tarefa 001: infra (002, 006, 007, 008, 010) ∥ db-dev (003) ∥ api-dev (004) ∥ web-dev (005) ∥ spec-guardian (009) ∥ qa (011, após 003).
- **Saída:** `pnpm install && docker compose up -d && pnpm dev` funciona; `pnpm verify:quick` e `verify:full` rodam; CI verde num PR. O critério "`https://<host>/api/health/ready` responde 200 e a SPA abre" passou para a F5.

## F1 — Identidade e carteira (25/10)
- **Objetivo:** cadastro, login, refresh, CSRF, ledger, depósito; telas de entrar/cadastro/carteira.
- **Specs:** 003, 004, 012.
- **Depende de:** F0.
- **Paralelo:** db-dev (schema users/ledger) → api-dev (auth, carteira) ∥ web-dev (telas com MSW sobre o OpenAPI) ∥ qa (integração auth/ledger).
- **Saída:** e2e "cadastro → login → depósito → saldo" verde; reconciliação do ledger verde.

## F2 — Catálogo e lotes (26/10)
- **Objetivo:** cliente Scryfall (bucket, circuito, cache), snapshot com imagem, criação de lote, vitrine com busca/filtros, painel do leiloeiro.
- **Specs:** 005, 006, 012.
- **Depende de:** F1.
- **Paralelo:** api-dev (catalogo, lotes) ∥ web-dev (vitrine, painel, novo lote) ∥ db-dev (lots, card_snapshots, índices) ∥ qa (testes com Scryfall mockada).
- **Saída:** com a Scryfall bloqueada, a vitrine e o detalhe do lote funcionam; criar lote pelo painel funciona com a Scryfall de pé.

## F3 — Lances, integridade e tempo real (26–27/10)
- **Objetivo:** transação do lance, recusas, anti-sniping, hash chain + Ed25519, Socket.IO, sala ao vivo.
- **Specs:** 007, 008, 009, 012.
- **Depende de:** F2.
- **Paralelo:** api-dev (lances + integridade) → api-dev (tempo-real) ∥ web-dev (sala, a partir do AsyncAPI) ∥ qa (concorrência de 50 lances, adulterações).
- **Saída:** e2e com dois navegadores: superado em < 1 s; 6 códigos de recusa cobertos; adulterações detectadas.

## F4 — Encerramento, liquidação, auditoria e estorno (27–28/10)
- **Objetivo:** job de 1 s, liquidação, selo, comprovante, auditoria pública com verificação no navegador, cancelamento com estorno, meus arremates, dark mode concluído.
- **Specs:** 006, 010, 011, 012.
- **Depende de:** F3.
- **Paralelo:** api-dev (liquidacao, auditoria) ∥ web-dev (auditoria, comprovante, meus arremates, painel de resultados) ∥ qa (e2e ponta a ponta + axe).
- **Saída:** fluxo completo do PDF demonstrável localmente; `pnpm demo:adulterar` → "adulterado".

## F5 — Entrega (28–29/10)
- **Objetivo:** deploy na VPS (ADR 0033):
  - compose de produção e Caddyfile;
  - hardening e runbook;
  - workflow de deploy com rollback;
  - um `pg_dump` manual antes da entrega, com o comando no runbook. Backup agendado, cópia externa, teste de restauração e uptime ficam fora do escopo da entrega (ADR 0034).

  Também: seed final, k6 contra a VPS (rodando de fora dela), hardening, README completo (setup, técnica antiadulteração, comportamentos inesperados, uso de IA, aviso de que `demo:adulterar` nunca roda em produção), release v1.0.0 e envio do formulário.
- **Specs:** 000, 013, 014.
- **Depende de:** F4.
- **Paralelo:** infra (compose de produção → deploy; hardening da VPS ∥ compose) ∥ qa (k6 depois do deploy, regressão) ∥ spec-guardian (README, docs, CHANGELOG).
- **Saída:**
  - `https://<subdominio>.duckdns.org/api/health/ready` responde 200 e a SPA abre;
  - critérios de specs/014 verdes;
  - checklist de sucesso de specs/000 completo;
  - tag `v1.0.0`;
  - formulário enviado.
