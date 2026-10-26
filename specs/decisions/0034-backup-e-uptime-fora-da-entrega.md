# 0034 — Backup agendado, cópia externa, teste de restauração e uptime fora do escopo da entrega

Status: aceita
Data: 2026-10-25
Decisão: do humano, em 2026-10-25 ("aceito os ajustes", repassado pelo orquestrador; a tarefa 132, de backup e uptime, foi removida)
Substitui parcialmente: ADR 0033 (item 5.3, só o comando `backup` do `deploy-ssh`; item 6 inteiro; item 7, só o UptimeRobot; pendência 6.2) e ADR 0018 (uptime check externo, `pg_dump` diário com 7 cópias e restore testado no CI)

## Contexto
A specs/000 exige deploy público (RF-14) e Docker Compose (RF-10). Ela não exige backup agendado, cópia externa, teste de restauração nem monitor de uptime. A ADR 0033 incluiu esses quatro itens na entrega da F5, com a cópia externa ainda provisória (item 6.2). Faltam 4 dias para o prazo (ADR 0001), e o humano decidiu tirar da entrega o que a specs/000 não pede.

## Decisão
1. **Fora do escopo da entrega e opcionais depois:**
   1. o cron diário de `pg_dump` com 7 cópias (ADR 0033, item 6.1; ADR 0018);
   2. a cópia fora da VPS cifrada com `age` e guardada como artefato do Actions (ADR 0033, item 6.2, que deixa de ser pendência);
   3. o teste de restauração no CI e a restauração real da cópia externa (ADR 0033, item 6.3; ADR 0018);
   4. o monitor do UptimeRobot com alerta por e-mail (ADR 0033, item 7; ADR 0018).
   Se algum deles entrar depois da entrega, entra por uma ADR nova.
2. **O que fica:** um `pg_dump -Fc` manual do banco `leilao`, feito uma vez pelo administrador antes da entrega. O comando fica no runbook (`docs/operacao.md`). O dump:
   - é feito pelo socket local do container do Postgres (`docker compose exec -T postgres`), sem senha no argv nem no ambiente;
   - é gravado na VPS fora dos volumes do Docker, com modo 600.
   Copiá-lo para fora da VPS é opcional.
3. **Comando forçado.** O `deploy-ssh` aceita só `deploy <sha>` e `rollback`. `backup` passa a ser um comando como qualquer outro não aceito: sai com código ≠ 0 sem executar nada.
4. **Mantidos da ADR 0033, item 7:** nenhum serviço cobrado por uso e nenhum alerta de orçamento. Os serviços externos passam a ser a VPS Hostinger, o DuckDNS, o Let's Encrypt e o GitHub (Actions e GHCR).

## Alternativas consideradas
- **Manter os itens da ADR 0033:** gasta tempo do infra e do humano em itens que a specs/000 não pede, a 4 dias do prazo.
- **Cortar também o `pg_dump` manual:** sem nenhum dump, uma falha no dia da avaliação perde os lotes e os lances feitos na demo. O dump manual custa um comando.
- **Só o cron diário, sem cópia externa:** é a ADR 0018 original. Ainda pede script, cron e um critério de 8 execuções, que não fecha a tempo de ser verificado antes da entrega.

## Consequências
- Se a VPS ou o volume do Postgres for perdido, os dados depois do último dump manual se perdem. O seed recria o estado inicial (como já aceitava a ADR 0018). As chaves públicas antigas continuam em `signing_keys` (ADR 0031), então um dump restaurado continua verificável.
- Sem monitor, uma queda só é notada por quem acessar o site. O critério de reboot da specs/014 continua garantindo a volta depois de um reinício.
- A chave de deploy só executa 2 comandos, o que reduz a superfície do `deploy-ssh` em relação à ADR 0033.
- specs/014 (§Observabilidade, §Backup, §CI/CD e critérios de aceite), specs/001 (§Qualidade e operação) e o PLAN (F5) passam a seguir esta ADR.
