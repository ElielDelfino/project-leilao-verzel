# Índice das specs

Fonte da verdade do projeto. Carregue cada spec sob demanda.

| Arquivo | Título | Escopo | Depende de | Status |
|---|---|---|---|---|
| [000-visao-geral.md](000-visao-geral.md) | Visão geral | propósito, usuários, escopo, RNFs | — | aprovada |
| [001-arquitetura.md](001-arquitetura.md) | Arquitetura | componentes, módulos, donos de dados, contratos, stack | 000 | aprovada |
| [002-organizacao-do-trabalho.md](002-organizacao-do-trabalho.md) | Organização do trabalho | papéis, Git, tarefas, DoD, escalonamento | 000, 001 | aprovada |
| [003-identidade-e-auth.md](003-identidade-e-auth.md) | Identidade e autenticação | cadastro, login, JWT, CSRF, seed | 000, 001 | aprovada |
| [004-carteira-ledger.md](004-carteira-ledger.md) | Carteira (ledger) | saldos, depósito, compromisso, liquidação | 001, 003 | aprovada |
| [005-catalogo-scryfall.md](005-catalogo-scryfall.md) | Catálogo (Scryfall) | busca, rate limit, circuito, snapshot, imagens | 001 | aprovada |
| [006-lotes.md](006-lotes.md) | Lotes | criação, vitrine, filtros, cancelamento com estorno, painel | 003, 004, 005 | aprovada |
| [007-lances-e-regras.md](007-lances-e-regras.md) | Lances e regras | transação do lance, recusas, anti-sniping | 004, 006, 008 | aprovada |
| [008-integridade-do-historico.md](008-integridade-do-historico.md) | Integridade do histórico | hash chain, Ed25519, selo, verificação | 001 | aprovada |
| [009-tempo-real.md](009-tempo-real.md) | Tempo real | Socket.IO, rooms, eventos, resync | 001, 006, 007 | aprovada |
| [010-encerramento-e-liquidacao.md](010-encerramento-e-liquidacao.md) | Encerramento e liquidação | job de 1 s, liquidação, comprovante | 004, 006, 007, 008 | aprovada |
| [011-auditoria-e-comprovante.md](011-auditoria-e-comprovante.md) | Auditoria e comprovante | página pública, comprovante, meus arremates | 008, 010 | aprovada |
| [012-frontend-telas.md](012-frontend-telas.md) | Frontend: telas | rotas, mensagens, dark mode, acessibilidade | 003–011 | aprovada |
| [013-verificacao-e-testes.md](013-verificacao-e-testes.md) | Verificação e testes | níveis de teste, verify quick/full | 001, 002 | aprovada |
| [014-deploy-e-operacao.md](014-deploy-e-operacao.md) | Deploy e operação | GCP e2-micro, CI/CD, segredos, backup | 001, 013 | aprovada |

Contratos: [`apps/api/openapi.yaml`](../apps/api/openapi.yaml) (criado na tarefa 009) · [`eventbus/socketio/asyncapi.yaml`](../eventbus/socketio/asyncapi.yaml)
Sistemas auxiliares: [`database/postgres/`](../database/postgres/README.md) · [`cache/redis/`](../cache/redis/README.md)
Decisões: [`decisions/HISTORY.md`](decisions/HISTORY.md)
