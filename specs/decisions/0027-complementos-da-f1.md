# 0027 — Complementos da F1: argon2id, JWT, cookies, rate limit, carteira e seed

Status: aceita
Data: 2026-10-25
Decisão: do humano, em 2026-10-25 (tarefa 036, itens D5 a D10 e D13 a D15 aprovados como recomendados)
Complementa: ADR 0006 e ADR 0011 (não as substitui)

## Contexto
Ao planejar a F1 (identidade e carteira), as tarefas 037 a 040 esbarraram em lacunas que as ADRs 0006 e 0011 e as specs 003, 004 e 014 não fechavam: a ADR 0011 lista "argon2" sem dizer qual pacote, e não nomeia as bibliotecas de JWT e de cookies; o rate limit tinha só o número (5/min), sem janela, chave nem contagem; a ordem das verificações (CSRF, autenticação, papel, validação, limite) não estava escrita; o atributo `Secure` dos cookies era "em produção", sem critério testável; a linha de `wallet_balances` não tinha regra de criação; e o `db:seed` não tinha como crescer por módulo sem uma tarefa de banco a cada fase. A ADR 0010 (Redis para rate limit) e a ADR 0007 (ledger) seguem valendo.

Fatos verificados em 2026-10-25: o Node 24.22.1 do projeto tem `crypto.argon2` (adicionado no Node 24.7.0), assíncrono, com `memory` em KiB; `jose@6.2.13` e `@fastify/cookie@11.1.3` são MIT; o `argon2@0.45.1` tem script `install` (`node-gyp-build`) e exigiria `allowBuilds` do infra.

## Decisão
1. **argon2id pelo `node:crypto.argon2`, assíncrono** (D5), sem dependência nativa nem de produção nova. `engines.node` passa a `>=24.7 <25`. Parâmetros do RNF-01 da specs/003: `memory` 19456 KiB (19 MiB), `passes` 2, `parallelism` 1.
2. **JWT HS256 com `jose@6.2.13`** (D6), dependência de produção (MIT, sem dependências).
3. **Cookies com `@fastify/cookie@11.1.3`** (D7), dependência de produção (MIT; depende de `cookie` ^2 e `fastify-plugin` ^6).
4. **Rate limit próprio no Redis**, sem `@fastify/rate-limit` (D8), que fica para o limite global da tarefa 020:
   - janela fixa de 60 s, com `INCR` e `EXPIRE ... NX` atômicos;
   - chaves `ratelimit:cadastro:{ip}` e `ratelimit:login:{ip}:{16 primeiros hex do SHA-256 do e-mail em minúsculas}`;
   - conta toda requisição com corpo válido, inclusive o 409 do cadastro (limita a enumeração de e-mails, ADR 0022) e o login bem-sucedido;
   - `Retry-After` = TTL restante, no mínimo 1;
   - os testes resetam por prefixo com `SCAN` + `DEL`, nunca `FLUSHDB` nem `FLUSHALL` (o Redis de dev é compartilhado pelos worktrees).
5. **Ordem das verificações** (D9): CSRF (403) → autenticação (401) → papel (403) → validação (422) → rate limit (429) → regra de negócio.
6. **`Secure` nos cookies quando `WEB_ORIGIN` começa com `https://`** (D10), e `WEB_ORIGIN` é obrigatório no boot. Precisa o critério "Secure em produção" da ADR 0022, item 1, sem mudar os demais atributos.
7. **Carteira** (D13): a linha de `wallet_balances` nasce no primeiro lançamento do usuário; sem linha, o saldo é zero. Página do extrato além da última → 200 com `dados: []`.
8. **Seed por módulo** (D14): o `db:seed` descobre as etapas em `apps/api/src/modules/<m>/seed.ts`, na ordem de specs/001 §Módulos, e cada etapa é idempotente. Nenhuma fase precisa de tarefa do db-dev só para registrar etapa.
9. **`trustProxy` fica na tarefa 020 (F5)** (D15). Até lá, em produção, o rate limit por IP vê o IP do Caddy: risco aceito, porque a F1 roda local.

## Alternativas consideradas
- **`argon2@0.45.1`:** pacote conhecido, mas traz script de `install` com compilação nativa e exige `allowBuilds` do infra (a mesma fricção das tarefas 024 e 029).
- **HMAC do `node:crypto` escrito à mão no lugar do `jose`:** sem dependência, mas é código de segurança próprio (cabeçalho, `alg`, `exp`, comparação) que a `jose` já testa.
- **`@fastify/rate-limit` desde já:** cobre o caso geral, mas a chave composta (IP + hash do e-mail), a contagem do 409 e a ordem após a validação pedem lógica própria; a biblioteca fica para o limite global.
- **Janela deslizante ou token bucket para o login:** mais justo nas bordas, porém mais caro de testar; a janela fixa dá 5 por minuto verificável e o pico de 10 tentativas na virada da janela é aceito na demo.
- **`Secure` por `NODE_ENV`:** acopla o atributo a um ambiente em vez de ao esquema real da origem; atrás de HTTP em CI com `NODE_ENV=production` os cookies seriam descartados pelo navegador.
- **Criar a linha de `wallet_balances` no cadastro:** o cadastro (`identidade`) passaria a escrever na tabela de `carteira`, o que viola a regra de donos de dados (specs/001); no seed, só cobriria as contas demo.
- **`trustProxy` já na F1:** exige decidir quais saltos confiar antes de haver o Caddy na frente; a tarefa 020 trata o endurecimento HTTP inteiro.

## Consequências
- Não há dependência nativa nova; `jose` e `@fastify/cookie` entram como dependências de produção de `@leilao/api`. O `argon2` assíncrono roda no pool de threads do libuv (4 por padrão): no máximo 4 hashes simultâneos, cerca de 76 MiB de pico de memória de hash (4 × 19 MiB), dentro dos 300 MB da API (specs/014), e logins além disso esperam na fila.
- Quem sondar e-mails com muitos IPs ainda os testa pelo 409; o risco da ADR 0022 permanece.
- A janela fixa permite até 10 tentativas em 2 segundos na virada da janela; aceito.
- Em produção, enquanto a tarefa 020 não entrar, todos os clientes dividem o limite do IP do Caddy: um cliente barulhento pode bloquear o cadastro e o login dos demais.
- Falha do Redis no rate limit segue a regra geral de specs/001 §Erros (500 `INDISPONIVEL`, falha fechada); não há decisão específica do humano para esse caso.
- Os testes de integração e o e2e precisam do reset por `SCAN` + `DEL` entre os casos; o e2e usa as portas padrão e o banco do worktree, e dois e2e simultâneos em worktrees diferentes não são suportados (specs/013).
- Os contratos `openapi.yaml` e `asyncapi.yaml` não mudam.
