---
name: deploy-e-rollback
description: Publica a main na VPS e desfaz um deploy. Use ao abrir ou mergear PR, acompanhar o deploy, conferir produção ou fazer rollback.
---

# Deploy e rollback

Nenhum agente acessa a VPS: os comandos da VPS são do humano, e o agente os entrega prontos. Runbook completo: `docs/operacao.md`; desenho do deploy: `docs/deploy.md`.

1. **Antes do PR.** `pnpm verify:full` verde na `main` local. O push só sai com aprovação do humano: o merge na `main` publica na VPS.
2. **Ler o CI.** Rode `gh pr checks <n>` num comando separado do merge e só depois faça o merge por rebase, com os checks principais verdes.
3. **Acompanhar.** O merge dispara o CI na `main` e, com ele verde, o workflow `Deploy` (`gh run list --branch main`). Pronto quando o run do Deploy terminar com sucesso.
4. **Conferir produção.** `GET /api/health/ready` responde 200 e a resposta traz `x-request-id`; `GET /api/auditoria/chaves` devolve a chave pública esperada.
5. **Falha no deploy.** Se o health falhar depois da troca, o `deploy-ssh` volta sozinho para a versão anterior e o job falha. O rollback não desfaz migrations.
6. **Rollback manual**, na VPS: `sudo -u deploy -H env SSH_ORIGINAL_COMMAND=rollback /opt/leilao/bin/deploy-ssh`. Um segundo rollback desfaz o primeiro. A versão no ar é `sudo readlink /home/deploy/leilao/atual`.
7. **Antes de mudança arriscada**, faça o `pg_dump` manual de `docs/operacao.md` §7.

"Re-run failed jobs" de um run antigo termina verde sem publicar se a `main` já andou; confira o `atual` antes de confiar nele.
