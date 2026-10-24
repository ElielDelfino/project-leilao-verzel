# 0006 — Autenticação: e-mail + senha, JWT em cookies httpOnly

Status: aceita
Data: 2026-10-24

## Decisão
Cadastro público com papel escolhido e imutável; argon2id; access JWT de 15 min + refresh opaco rotativo de 7 dias com detecção de reuso; cookies httpOnly SameSite=Lax; CSRF por double-submit; Socket.IO autenticado pelo cookie; sem administrador (o seed cria 1 leiloeiro + 2 licitantes).

## Alternativas consideradas
- Sessão opaca no Redis: revogação imediata, mas um acesso ao Redis por request.
- OAuth: atrapalha o avaliador, que precisa das contas seed com senha.

## Consequências
Revogação do access token leva até 15 min (aceitável para a demo). Detalhes em specs/003.
