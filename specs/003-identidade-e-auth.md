# 003 — Identidade e autenticação

Status: aprovada
Depende de: 000, 001

## Contexto
Dois papéis com permissões disjuntas. Sem recuperação de senha (fora de escopo) e sem administrador.

## Requisitos
- RF-01 Cadastro público com nome (2–80 caracteres), e-mail (único, case-insensitive), senha (10–128 caracteres) e papel (`leiloeiro` | `licitante`). O papel é imutável.
- RF-02 Login, logout, refresh e `me`.
- RF-03 O seed cria `leiloeiro@demo.local`, `ana@demo.local` e `bruno@demo.local` (licitantes) com a senha de `SEED_DEMO_PASSWORD`, publicada no README.
- RNF-01 Senha com hash argon2id (parâmetros padrão OWASP 2025: m=19 MiB, t=2, p=1).
- RNF-02 Rate limit do login: 5 tentativas/min por IP + e-mail → 429 `MUITAS_TENTATIVAS`.
- RNF-03 Mensagem de login inválido idêntica para e-mail inexistente e senha errada (`CREDENCIAIS_INVALIDAS`).

## Comportamento
- Access token JWT HS256 (15 min) no cookie `access_token` (httpOnly, Secure em prod, SameSite=Lax, Path=/).
- Refresh token opaco (256 bits) no cookie `refresh_token` (httpOnly, Path=/api/auth/refresh, 7 dias). No banco só fica o SHA-256. Cada uso gera um novo token na mesma família; reuso de um token já substituído revoga a família inteira.
- CSRF: cookie `csrf_token` (não httpOnly) + header `X-CSRF-Token` obrigatório em POST/PUT/PATCH/DELETE; comparação em tempo constante.
- Guards: `@Papel('licitante')`, `@Papel('leiloeiro')`, `@Publico()`. Recurso de outro usuário → 404 (não 403), para não vazar existência.
- Socket.IO: o handshake lê o cookie `access_token`; conexão sem token é aceita como anônima (só leitura).
- Job diário remove refresh tokens expirados há mais de 1 dia.

## Interfaces e contratos
`apps/api/openapi.yaml`, tag `auth`:
- `POST /api/auth/cadastro` → 201 `{usuario}` + cookies · 409 `EMAIL_EM_USO` · 422 `DADOS_INVALIDOS`
- `POST /api/auth/login` → 200 `{usuario}` + cookies · 401 `CREDENCIAIS_INVALIDAS` · 429
- `POST /api/auth/refresh` → 204 + cookies novos · 401 `SESSAO_EXPIRADA`
- `POST /api/auth/logout` → 204 (revoga a família)
- `GET /api/auth/me` → 200 `{id, nome, email, papel}` · 401

## Dados
- `users(id uuid pk default uuidv7(), nome text, email citext unique, senha_hash text, papel papel_usuario, criado_em timestamptz)`
- `refresh_tokens(id uuid pk, user_id fk, familia_id uuid, token_hash bytea unique, expira_em, revogado_em null, substituido_por null, criado_em)`
- Retenção: usuários permanentes (sem exclusão de conta, ADR 0001); refresh tokens expirados expurgados diariamente.

## Critérios de aceite
- [ ] Leiloeiro não consegue chamar rotas de licitante, e vice-versa (testes de integração).
- [ ] Reuso de refresh token revoga a família.
- [ ] POST sem `X-CSRF-Token` → 403 `CSRF_INVALIDO`.
- [ ] 6º login em 1 min → 429.

## Fora de escopo
Recuperação de senha, verificação de e-mail, OAuth, 2FA, exclusão de conta.

## Decisões relacionadas
- decisions/0006-autenticacao-jwt-cookies.md
