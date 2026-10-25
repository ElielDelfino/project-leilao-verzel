# 0025 — Cancelamento de lote em `liquidacao` e arestas dos módulos

Status: aceita
Data: 2026-10-25
Decisão: do humano, em 2026-10-25 (tarefa 012, conflito entre specs/006 e specs/001 achado na tarefa 001)
Complementa: ADR 0003 (não a substitui)

## Contexto
A specs/006 (RF-04) fazia o módulo `lotes` cancelar o lote, estornar o líder (`carteira`) e selar o histórico (`lot_seals`, que pertence a `lances`); a "posição do usuário" em `GET /api/lotes/{id}` pedia os lances do usuário. A ordem de dependência da specs/001 não tinha nenhuma aresta saindo de `lotes`, e `lotes → lances` fecharia um ciclo, porque `lances → lotes` (o lance trava e atualiza o lote). Ciclos são proibidos pelo `eslint-plugin-boundaries` (ADR 0003). A specs/001 também não dizia onde ficam os módulos nem que o import só pode ser pelo `index.ts`, e três outras dependências reais não estavam na tabela: o guard de papéis, o estado inicial da sala (`tempo-real`) e o comprovante (`liquidacao`).

## Decisão
1. **O cancelamento passa para `liquidacao`**, com a mesma rota `POST /api/painel/lotes/{id}/cancelamento`. Uma transação: lote `FOR UPDATE` (pela interface de `lotes`) → `carteira.estornar` (líder, se houver) → `lances.selar` com status `cancelado` → status `cancelado` (pela interface de `lotes`). Os eventos `lote_cancelado` e `saldo_atualizado` saem depois do COMMIT. A ordem de locks (lote, depois carteiras) segue a specs/004.
2. **A posição do usuário em `GET /api/lotes/{id}` usa só as colunas de `lots`** (`ganhando` ou `venceu`; sem posição nos demais casos). "Superado" e as outras posições vêm do ack de `entrar_lote` (specs/009) e de `GET /api/me/lances` (specs/007), onde `lances` conhece os lances do usuário. Valores da posição: `ganhando`, `superado`, `venceu`, `perdeu`, `sem_lance`.
3. **Arestas finais** (`A → B`: A importa a interface pública de B): `lotes → catalogo`; `lances → lotes, carteira, catalogo, identidade`; `liquidacao → lances, lotes, carteira, catalogo`; `tempo-real → lotes, lances, identidade`. `identidade`, `carteira` e `catalogo` não importam outro módulo. `tempo-real` continua consumindo os eventos de domínio publicados após o COMMIT.
4. **Guards** `@Papel` e `@Publico` ficam em `apps/api/src/common/auth/`, só com metadados (decoradores); o guard global é registrado por `identidade` via `APP_GUARD`. Nenhum módulo importa outro por causa dos guards.
5. **`lots` guarda `carta_nome` e `raridade`**, copiados do snapshot na criação, para a vitrine filtrar e buscar (trigram) sem JOIN com a tabela de `catalogo`. A migration é do db-dev, na F2.
6. **Convenção de código:** cada módulo fica em `apps/api/src/modules/<nome>/`, expõe só o `index.ts`, e o lint recusa import fora da aresta ou que não passe pelo `index.ts` (specs/001 §Módulos da API).

## Alternativas consideradas
- **Porta em `lotes/index.ts` implementada por `lances` no boot (inversão de dependência):** `lotes` ficaria com 2 arestas e o cancelamento no módulo do lote, mas o ciclo continua existindo em tempo de execução e o lint não o enxerga.
- **Cancelar em `lotes` e selar por evento depois do COMMIT:** o selo deixa de ser atômico com o cancelamento; uma queda entre o COMMIT e o evento deixaria um lote cancelado sem selo, o que a verificação 5 da specs/008 trata como adulteração.
- **`lotes` ler `bids` direto para a posição:** viola "nenhum módulo lê a tabela de outro".

## Consequências
- `liquidacao` passa a ter duas responsabilidades de mudança de estado do lote (encerrar e cancelar), as duas com a mesma sequência de travas e o mesmo selo; `lotes` expõe operações de travar e de mudar status para ela.
- `lotes` não depende de `lances` nem de `carteira`; o grafo é acíclico (folhas: `identidade`, `carteira`, `catalogo`).
- Tarefas decorrentes: o infra atualiza `DEPENDENCIAS_PERMITIDAS` em `eslint.config.mjs` (`lotes`, `liquidacao` com `catalogo`, `tempo-real`); a tarefa 013 é ajustada; o db-dev inclui `carta_nome` e `raridade` na migration de `lots` (F2).
- Os contratos `openapi.yaml` e `asyncapi.yaml` não mudam: a rota de cancelamento é a mesma e as rotas de lotes ainda não estão no contrato. O campo da posição entra no contrato quando as rotas de lotes entrarem (F2/F3).
