# 0022 — Complementos de autenticação e idempotência do depósito

Status: aceita
Data: 2026-10-24
Complementa: ADR 0006 (não a substitui)

## Contexto
Ao escrever o contrato da F1 (tarefa 009), surgiram lacunas que a ADR 0006 e as specs 003 e 004 não resolviam. Com o refresh token em `Path=/api/auth/refresh`, o cookie não chegava ao logout, que precisa revogar a família. Um cliente anônimo não tinha como obter o `csrf_token` exigido no cadastro e no login. Não havia código de erro para rota restrita a outro papel. O cadastro não tinha rate limit, e o 409 `EMAIL_EM_USO` permite enumerar e-mails. Faltava a regra para uma `Idempotency-Key` repetida com corpo diferente. Todas as decisões abaixo são do humano, tomadas nesta sessão.

## Decisão
1. **Cookie `refresh_token` em `Path=/api/auth`.** Como o Path casa por prefixo, o cookie chega a todas as rotas sob `/api/auth` (incluindo refresh e logout) e a nenhuma outra rota da API. O logout revoga a família e expira os três cookies com os mesmos Path da emissão. Atributos: HttpOnly, SameSite=Lax e Secure em produção nos três cookies; o `csrf_token` não é HttpOnly, tem Max-Age=604800 e é reemitido no cadastro, no login e no refresh (tabela em specs/003 §Cookies).
2. **`GET /api/auth/csrf`**, sem autenticação: 204 + `Set-Cookie csrf_token`. A SPA a chama antes do primeiro POST, quando o cookie não existe.
3. **Código `PAPEL_NAO_PERMITIDO` (403)** para rota restrita a outro papel, como o leiloeiro em `POST /api/carteira/depositos`. O lance mantém `LEILOEIRO_NAO_PODE_LANCAR` (specs/007), e recurso de outro usuário continua com 404 (specs/003).
4. **Rate limit do cadastro:** 5 por minuto por IP → 429 `MUITAS_TENTATIVAS` com `Retry-After`. O risco de enumeração pelo 409 que sobra é aceito e fica registrado em specs/003.
5. **`Idempotency-Key` repetida com corpo diferente** → 422 `DADOS_INVALIDOS`, sem lançamento novo. Com o mesmo corpo → 200, com o mesmo lançamento (specs/004).

## Alternativas consideradas
- Logout pelo `familia_id` como claim do JWT de acesso: falha quando o access token já expirou.
- Dispensar o CSRF no cadastro e no login: deixa aberto o login CSRF.
- Emitir o `csrf_token` em qualquer resposta sem cookie: espalha emissão de cookie pela API toda.
- 404 para papel errado: a rota é pública e conhecida, então o 404 não esconde nada e só confunde.
- Cadastro sem 409, com resposta genérica: exigiria verificação de e-mail, que está fora de escopo.

## Consequências
- O `refresh_token` também viaja para csrf, cadastro, login e me; só refresh e logout o leem.
- `codigos.ts` da API precisa do código novo (tarefa 022) e é integrado junto com o contrato.
- As suítes de teste precisam resetar o rate limit do cadastro entre os casos.
