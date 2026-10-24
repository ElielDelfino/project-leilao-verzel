# 003 — Identidade e autenticação

Status: aprovada
Depende de: 000, 001

## Contexto
Dois papéis com permissões disjuntas. Sem recuperação de senha (fora de escopo) e sem administrador.

## Requisitos
- RF-01 Cadastro público com nome (2–80 caracteres), e-mail (único, case-insensitive, até 254 caracteres), senha (10–128 caracteres) e papel (`leiloeiro` | `licitante`). O papel é imutável.
- RF-02 Login (e-mail até 254 caracteres, senha de 1 a 128 caracteres), logout, refresh, `me` e emissão do token CSRF.
- RF-03 O seed cria `leiloeiro@demo.local`, `ana@demo.local` e `bruno@demo.local` (licitantes) com a senha de `SEED_DEMO_PASSWORD`, publicada no README. Ela não é segredo: valor fixo no `.env` versionado, o mesmo em dev, CI e produção, com 10 a 128 caracteres `A–Z a–z 0–9 - _`. Valor: `leilao-demo-2026` (ADR 0023; origem em specs/014 §Segredos).
- RNF-01 Senha com hash argon2id (parâmetros padrão OWASP 2025: m=19 MiB, t=2, p=1).
- RNF-02 Rate limit do login: 5 tentativas/min por IP + e-mail → 429 `MUITAS_TENTATIVAS` com header `Retry-After` (segundos).
- RNF-03 Mensagem de login inválido idêntica para e-mail inexistente e senha errada (`CREDENCIAIS_INVALIDAS`). Para e-mail inexistente, o login verifica a senha contra um hash argon2id dummy (mesmos parâmetros do RNF-01), para que o tempo de resposta seja o mesmo nos dois casos.
- RNF-04 Rate limit do cadastro: 5 cadastros/min por IP → 429 `MUITAS_TENTATIVAS` com header `Retry-After` (segundos).

## Comportamento
- Access token JWT HS256 (15 min) no cookie `access_token`, assinado com os 32 bytes decodificados de `JWT_SECRET` (base64url canônico sem padding, 43 caracteres; formato e origem em specs/014 §Segredos, ADR 0023). Refresh token opaco (256 bits) no cookie `refresh_token`; no banco só fica o SHA-256. Cada uso gera um novo token na mesma família; reuso de um token já substituído revoga a família inteira.
- CSRF: cookie `csrf_token` (não httpOnly) + header `X-CSRF-Token` obrigatório em POST/PUT/PATCH/DELETE, inclusive cadastro e login; comparação em tempo constante. `GET /api/auth/csrf` (sem autenticação) emite um `csrf_token` novo; a SPA a chama antes do primeiro POST só quando o cookie `csrf_token` não existir.
- Logout: lê o `refresh_token`, revoga a família dele (se houver) e expira os três cookies com os mesmos `Path` da emissão. Responde 204 mesmo sem sessão.
- Guards: `@Papel('licitante')`, `@Papel('leiloeiro')`, `@Publico()`. Rota restrita a outro papel → 403 `PAPEL_NAO_PERMITIDO` (ex.: leiloeiro em `POST /api/carteira/depositos`); o lance tem código próprio, `LEILOEIRO_NAO_PODE_LANCAR` (specs/007). Recurso de outro usuário → 404 (não 403), para não vazar existência.
- Corpo com campo desconhecido → 422 `DADOS_INVALIDOS`.
- Socket.IO: o handshake lê o cookie `access_token`; conexão sem token é aceita como anônima (só leitura).
- Job diário remove refresh tokens expirados há mais de 1 dia.

### Cookies
"Secure em produção": o atributo `Secure` só fica ausente em dev (`http://localhost`). Na expiração (logout), cada cookie é reenviado com valor vazio, `Max-Age=0` e os mesmos atributos.

| Cookie | HttpOnly | Secure | SameSite | Path | Max-Age | Emitido por |
|---|---|---|---|---|---|---|
| `access_token` | sim | em produção | Lax | `/` | 900 (15 min) | cadastro, login, refresh |
| `refresh_token` | sim | em produção | Lax | `/api/auth` | 604800 (7 dias) | cadastro, login, refresh |
| `csrf_token` | não | em produção | Lax | `/` | 604800 (7 dias) | `GET /api/auth/csrf`, cadastro, login, refresh |

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
- Retenção: usuários permanentes (sem exclusão de conta, ADR 0001); refresh tokens expirados expurgados diariamente.

## Critérios de aceite
- [ ] Leiloeiro não consegue chamar rotas de licitante, e vice-versa (testes de integração); leiloeiro em `POST /api/carteira/depositos` → 403 `PAPEL_NAO_PERMITIDO`.
- [ ] Reuso de refresh token revoga a família.
- [ ] Logout revoga a família e expira os três cookies (`Max-Age=0`, mesmos `Path`).
- [ ] POST sem `X-CSRF-Token` → 403 `CSRF_INVALIDO`.
- [ ] Os cookies saem com os atributos da tabela §Cookies.
- [ ] 6º login em 1 min → 429 com `Retry-After`.
- [ ] 6º cadastro em 1 min do mesmo IP → 429 com `Retry-After`.
- [ ] Corpo com campo desconhecido → 422 `DADOS_INVALIDOS`.

## Fora de escopo
Recuperação de senha, verificação de e-mail, OAuth, 2FA, exclusão de conta.

## Decisões relacionadas
- decisions/0006-autenticacao-jwt-cookies.md, 0022-complementos-auth-e-idempotencia.md, 0023-segredos-em-arquivo-e-formatos.md
