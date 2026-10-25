# 003 — Identidade e autenticação

Status: aprovada
Depende de: 000, 001

## Contexto
Dois papéis com permissões disjuntas. Sem recuperação de senha (fora de escopo) e sem administrador.

## Requisitos
- RF-01 Cadastro público com nome (2–80 caracteres), e-mail (único, case-insensitive, até 254 caracteres), senha (10–128 caracteres) e papel (`leiloeiro` | `licitante`). O papel é imutável.
- RF-02 Login (e-mail até 254 caracteres, senha de 1 a 128 caracteres), logout, refresh, `me` e emissão do token CSRF.
- RF-03 O seed cria `leiloeiro@demo.local`, `ana@demo.local` e `bruno@demo.local` (licitantes) com a senha de `SEED_DEMO_PASSWORD`, publicada no README. Ela não é segredo: valor fixo no `.env` versionado, o mesmo em dev, CI e produção, com 10 a 128 caracteres `A–Z a–z 0–9 - _`. Valor: `leilao-demo-2026` (ADR 0023; origem em specs/014 §Segredos).
- RNF-01 Senha com hash argon2id pelo `crypto.argon2` assíncrono do Node (≥ 24.7.0), sem dependência nativa (ADR 0027), com os parâmetros OWASP 2025: `memory` 19456 KiB (19 MiB), `passes` 2, `parallelism` 1.
- RNF-02 Rate limit do login: 5 tentativas/min por IP + e-mail → 429 `MUITAS_TENTATIVAS` com header `Retry-After` (segundos); janela, chave e contagem em §Rate limit.
- RNF-03 Mensagem de login inválido idêntica para e-mail inexistente e senha errada (`CREDENCIAIS_INVALIDAS`). Para e-mail inexistente, o login verifica a senha contra um hash argon2id dummy (mesmos parâmetros do RNF-01), para que o tempo de resposta seja o mesmo nos dois casos.
- RNF-04 Rate limit do cadastro: 5 cadastros/min por IP → 429 `MUITAS_TENTATIVAS` com header `Retry-After` (segundos); janela, chave e contagem em §Rate limit.

## Comportamento
- Access token JWT HS256 (15 min, biblioteca `jose` 6.2.13, dependência de produção; ADR 0027) no cookie `access_token`, assinado com os 32 bytes decodificados de `JWT_SECRET` (base64url canônico sem padding, 43 caracteres; formato e origem em specs/014 §Segredos, ADR 0023). Refresh token opaco (256 bits) no cookie `refresh_token`; no banco só fica o SHA-256. Cada uso gera um novo token na mesma família; reuso de um token já substituído revoga a família inteira.
- CSRF: cookie `csrf_token` (não httpOnly) + header `X-CSRF-Token` obrigatório em POST/PUT/PATCH/DELETE, inclusive cadastro e login; comparação em tempo constante. `GET /api/auth/csrf` (sem autenticação) emite um `csrf_token` novo; a SPA a chama antes do primeiro POST só quando o cookie `csrf_token` não existir.
- Logout: lê o `refresh_token`, revoga a família dele (se houver) e expira os três cookies com os mesmos `Path` da emissão. Responde 204 mesmo sem sessão.
- Guards: `@Papel('licitante')`, `@Papel('leiloeiro')`, `@Publico()`, `@SessaoOpcional()` (rota pública que, havendo sessão válida, identifica o usuário; ver abaixo). Rota restrita a outro papel → 403 `PAPEL_NAO_PERMITIDO` (ex.: leiloeiro em `POST /api/carteira/depositos`); o lance tem código próprio, `LEILOEIRO_NAO_PODE_LANCAR` (specs/007). Recurso de outro usuário → 404 (não 403), para não vazar existência.
- Corpo com campo desconhecido → 422 `DADOS_INVALIDOS`.
- Socket.IO: o handshake lê o cookie `access_token`; conexão sem token é aceita como anônima (só leitura).
- Job diário remove refresh tokens expirados há mais de 1 dia.

### Ordem das verificações
Toda rota aplica as verificações nesta ordem e para na primeira que falhar (ADR 0027):
1. CSRF (POST/PUT/PATCH/DELETE) → 403 `CSRF_INVALIDO`;
2. autenticação → 401 `NAO_AUTENTICADO`;
3. papel → 403 `PAPEL_NAO_PERMITIDO`;
4. validação do corpo, dos parâmetros e dos headers → 422 `DADOS_INVALIDOS`;
5. rate limit → 429 `MUITAS_TENTATIVAS`;
6. regra de negócio (`EMAIL_EM_USO`, `CREDENCIAIS_INVALIDAS`, `SALDO_INSUFICIENTE` etc.).

Rota `@Publico()` (cadastro, login, csrf, refresh, logout) pula as etapas 2 e 3. Consequência: requisição com corpo inválido não conta no rate limit (etapa 4 antes da 5).

Rota `@SessaoOpcional()` (hoje `GET /api/lotes/{id}`, specs/006) também pula a etapa 3 e faz da etapa 2 uma leitura sem recusa: com cookie `access_token` válido, o usuário fica disponível à rota; com cookie ausente, malformado, de assinatura inválida ou expirado, a requisição segue como anônima. Nunca responde 401 (`NAO_AUTENTICADO`), nunca dispara o refresh no servidor e nunca troca nem apaga cookies. `@Publico()` continua sem ler o cookie.

### Rate limit
Um contador por chave no Redis, implementado pela própria API (sem `@fastify/rate-limit`, que fica para o limite global da tarefa 020; ADR 0027):
- Janela fixa de 60 s: `INCR` na chave e `EXPIRE <chave> 60 NX` numa operação atômica (script Lua ou `MULTI`); a 6ª contagem na janela é recusada.
- Chaves: `ratelimit:cadastro:{ip}` e `ratelimit:login:{ip}:{h}`, em que `{h}` são os 16 primeiros caracteres hexadecimais do SHA-256 do e-mail em minúsculas. O e-mail em texto nunca entra na chave.
- Conta toda requisição que chegou à etapa 5 (corpo válido), inclusive o cadastro que termina em 409 `EMAIL_EM_USO` (limita a enumeração) e o login bem-sucedido.
- O `Retry-After` é o TTL restante da chave em segundos, no mínimo 1.
- Redis fora → 500 `INDISPONIVEL` (falha fechada, specs/001 §Erros).
- `{ip}` é o IP da conexão; em produção, até a tarefa 020 (`trustProxy`, F5), é o do Caddy, e todos os clientes dividem o limite (risco aceito, ADR 0027).
- Os testes resetam o limite apagando as chaves do prefixo `ratelimit:` com `SCAN` + `DEL`, nunca `FLUSHDB` nem `FLUSHALL` (o Redis de dev é compartilhado entre worktrees; specs/013).

### Cookies
O atributo `Secure` fica presente quando `WEB_ORIGIN` (obrigatória no boot da API) começa com `https://` e ausente caso contrário (dev em `http://localhost`); não depende de `NODE_ENV` (ADR 0027, que precisa o "Secure em produção" da ADR 0022). Na expiração (logout), cada cookie é reenviado com valor vazio, `Max-Age=0` e os mesmos atributos.

| Cookie | HttpOnly | Secure | SameSite | Path | Max-Age | Emitido por |
|---|---|---|---|---|---|---|
| `access_token` | sim | se `WEB_ORIGIN` é https | Lax | `/` | 900 (15 min) | cadastro, login, refresh |
| `refresh_token` | sim | se `WEB_ORIGIN` é https | Lax | `/api/auth` | 604800 (7 dias) | cadastro, login, refresh |
| `csrf_token` | não | se `WEB_ORIGIN` é https | Lax | `/` | 604800 (7 dias) | `GET /api/auth/csrf`, cadastro, login, refresh |

O `Path` casa por prefixo: com `Path=/api/auth`, o `refresh_token` chega às rotas sob `/api/auth` (incluindo refresh e logout, e também csrf, cadastro, login e me) e não às demais rotas da API. Só o refresh e o logout leem esse cookie; o login com um `refresh_token` recebido revoga a família desse token antes de emitir os cookies novos (opção conservadora: nunca deixa duas famílias vivas para o mesmo navegador). As demais rotas sob `/api/auth` ignoram o cookie.

### Risco restante: enumeração de e-mail
O 409 `EMAIL_EM_USO` do cadastro revela se um e-mail já tem conta. O RNF-04 limita a sondagem a 5 tentativas/min por IP; quem usar muitos IPs ainda consegue testar e-mails. Risco aceito: os dados da demo são simulados e o login não vaza essa informação (RNF-03).

## Interfaces e contratos
`apps/api/openapi.yaml`, tag `auth`:
- `GET /api/auth/csrf` → 204 + cookie `csrf_token`
- `POST /api/auth/cadastro` → 201 `{usuario}` + cookies · 403 `CSRF_INVALIDO` · 409 `EMAIL_EM_USO` · 422 `DADOS_INVALIDOS` · 429 `MUITAS_TENTATIVAS`
- `POST /api/auth/login` → 200 `{usuario}` + cookies · 401 `CREDENCIAIS_INVALIDAS` · 403 · 422 · 429 `MUITAS_TENTATIVAS`
- `POST /api/auth/refresh` → 204 + cookies novos · 401 `SESSAO_EXPIRADA` · 403
- `POST /api/auth/logout` → 204 + cookies expirados (revoga a família) · 403
- `GET /api/auth/me` → 200 `{id, nome, email, papel}` · 401 `NAO_AUTENTICADO`

## Dados
- `users(id uuid pk default uuidv7(), nome text, email citext unique, senha_hash text, papel papel_usuario, criado_em timestamptz)`
- `refresh_tokens(id uuid pk, user_id fk, familia_id uuid, token_hash bytea unique, expira_em, revogado_em null, substituido_por null, criado_em)`
- `senha_hash` guarda a string PHC do argon2id (`$argon2id$v=19$m=19456,t=2,p=1$<sal base64>$<hash base64>`), que leva os parâmetros junto do hash; a verificação lê os parâmetros dela (o hash dummy do RNF-03 tem o mesmo formato).
- Retenção: usuários permanentes (sem exclusão de conta, ADR 0001); refresh tokens expirados expurgados diariamente.

## Critérios de aceite
- [ ] Leiloeiro não consegue chamar rotas de licitante, e vice-versa (testes de integração); leiloeiro em `POST /api/carteira/depositos` → 403 `PAPEL_NAO_PERMITIDO`.
- [ ] Reuso de refresh token revoga a família.
- [ ] Logout revoga a família e expira os três cookies (`Max-Age=0`, mesmos `Path`).
- [ ] POST sem `X-CSRF-Token` → 403 `CSRF_INVALIDO`.
- [ ] Os cookies saem com os atributos da tabela §Cookies, com `Secure` quando `WEB_ORIGIN=https://...` e sem `Secure` quando `WEB_ORIGIN=http://...` (teste de integração com os dois valores, independente de `NODE_ENV`); a API não sobe sem `WEB_ORIGIN`.
- [ ] 6º login em 1 min com o mesmo IP e e-mail → 429 com `Retry-After` entre 1 e 60; um e-mail diferente do mesmo IP não é bloqueado; maiúsculas no e-mail não escapam do limite.
- [ ] 6º cadastro em 1 min do mesmo IP → 429 com `Retry-After` entre 1 e 60; 5 cadastros com 409 `EMAIL_EM_USO` já consomem a janela (o 409 conta); requisições com corpo inválido (422) não contam.
- [ ] O Redis do teste só perde as chaves `ratelimit:*` entre os casos (nenhuma chamada a `FLUSHDB` ou `FLUSHALL` no código nem nos testes).
- [ ] Ordem das verificações (teste de integração em `POST /api/carteira/depositos`): sem `X-CSRF-Token` e sem sessão → 403 `CSRF_INVALIDO`; com CSRF e sem sessão → 401; leiloeiro com corpo inválido → 403 `PAPEL_NAO_PERMITIDO`; licitante com corpo inválido → 422; e, em `POST /api/auth/login`, corpo inválido repetido 6 vezes → sempre 422, nunca 429.
- [ ] RNF-03 (teste com espião sobre a função de verificação argon2id): o login com e-mail inexistente chama a verificação exatamente uma vez, contra o hash dummy (mesmos parâmetros do RNF-01), e responde 401 `CREDENCIAIS_INVALIDAS` com o mesmo corpo do login com senha errada.
- [ ] RNF-01 (teste de unidade com espião): toda chamada a `crypto.argon2` usa o algoritmo `argon2id`, `memory` 19456, `passes` 2 e `parallelism` 1, tanto no cadastro quanto na verificação do login e do hash dummy; a API não depende do pacote `argon2`.
- [ ] Formato do hash (teste de integração): depois de um cadastro, o `senha_hash` gravado casa com `^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$` (sal e hash em base64 sem padding), e o login com a senha certa passa e com a errada falha usando só o que está na string.
- [ ] Corpo com campo desconhecido → 422 `DADOS_INVALIDOS`.
- [ ] `@SessaoOpcional()` (teste de integração em `GET /api/lotes/{id}`): sem cookie, com cookie malformado, com JWT de assinatura errada e com JWT expirado → 200 como anônimo (`suaPosicao` `null`), sem `Set-Cookie`; com JWT válido → o usuário é identificado.

## Fora de escopo
Recuperação de senha, verificação de e-mail, OAuth, 2FA, exclusão de conta.

## Decisões relacionadas
- decisions/0006-autenticacao-jwt-cookies.md, 0022-complementos-auth-e-idempotencia.md, 0023-segredos-em-arquivo-e-formatos.md, 0027-complementos-da-f1.md
