# 006 — Lotes

Status: aprovada
Depende de: 003, 004, 005

## Requisitos
- RF-01 O leiloeiro cria um lote a partir de uma carta: título (default = nome da carta), descrição opcional, lance inicial, incremento mínimo, início e fim.
- RF-02 Vitrine pública separada em ao vivo, agendados e encerrados; cancelados nunca aparecem.
- RF-03 Busca e filtro: texto (título/carta), status, faixa de preço (lance atual ou inicial), raridade; ordenação por "termina antes", "mais recente" e "maior lance"; paginação de 24.
- RF-04 Cancelamento pelo dono enquanto agendado ou ao vivo. Com lances, faz **estorno automático** do compromisso do líder (specs/004) na mesma transação e sela o histórico com status `cancelado`. A operação é executada pelo módulo `liquidacao` (specs/010 §Cancelamento, ADR 0025), porque envolve `carteira` e `lances`, que `lotes` não importa (specs/001).
- RF-05 Painel do leiloeiro: todos os seus lotes (inclusive cancelados), resultado de cada encerrado (arrematado ou não, por quanto) e total recebido.

## Comportamento

### Criação (`POST /api/painel/lotes`)
Corpo `{scryfallId, titulo?, descricao?, lanceInicialCentavos, incrementoMinimoCentavos, inicioEm, fimEm}`, sem campos desconhecidos (specs/003). Validações (422 `DADOS_INVALIDOS` com `detalhes.campo` = nome do primeiro campo inválido, na ordem do corpo):
- `scryfallId`: UUID (a existência da carta é verificada no preparo do snapshot, specs/005);
- `titulo`: opcional; de 1 a 120 caracteres como recebido; o servidor remove os espaços das pontas antes de gravar. Ausente, `null` ou só espaços → o nome da carta, truncado em 120 caracteres;
- `descricao`: opcional; até 2000 caracteres como recebida; o servidor remove os espaços das pontas antes de gravar. Ausente, `null`, vazia ou só espaços → sem descrição (gravada como `null`);
- lance inicial ≥ R$ 1,00 e incremento ≥ R$ 1,00; ambos ≤ R$ 1.000.000,00 (100 a 100.000.000 centavos);
- `inicioEm` e `fimEm`: instantes ISO 8601 com fuso; início ≥ agora − 1 min (aceita "agora"); fim ≥ início + 5 min; duração (fim − início) ≤ 7 dias.

Ordem: validação (422) → `catalogo.prepararSnapshot` (rede, fora da transação; falha → 503 `CATALOGO_OCUPADO` | `CATALOGO_INDISPONIVEL`, ou 422 com `detalhes.campo` `scryfallId`, specs/005) → numa transação, `catalogo.gravarSnapshot(tx, ...)` e o INSERT do lote. Nada é criado se qualquer etapa falhar. Resposta 201 com o lote (schema `Lote`). Sem `Idempotency-Key` na F2: um duplo envio cria dois lotes (a UI desabilita o botão ao enviar, specs/012).

Status gravado na criação: `ao_vivo` se `inicio_em` ≤ agora, senão `agendado`. `carta_nome` e `raridade` são copiados do snapshot.

### Estados e status derivado
Estados gravados: `agendado → ao_vivo → encerrado`; `agendado|ao_vivo → cancelado`.
- As transições por tempo são feitas pelo job (specs/010). Para não depender dele, **a regra de lance usa os horários** (`inicio_em <= agora < fim_em`) sob lock, e a vitrine e o painel derivam o status dos horários.
- "Agora" é o relógio do Postgres (`now()` da instrução). Status derivado, usado na resposta, no filtro `status` e na ordenação:
  - `cancelado` se o status gravado for `cancelado` (nunca aparece na vitrine);
  - `encerrado` se o status gravado for `encerrado`, ou se `fim_em` ≤ agora;
  - `agendado` se agora < `inicio_em`;
  - `ao_vivo` se `inicio_em` ≤ agora < `fim_em`.
- `fim_em` pode ser estendido pelo anti-sniping (specs/007); `fim_original_em` guarda o valor inicial.

### Vitrine (`GET /api/lotes`, público)
Parâmetros (todos opcionais; fora do contrato → 422 com `detalhes.campo`):
- `status`: `ao_vivo`, `agendado` ou `encerrado`. Ausente = os três juntos (cancelados nunca);
- `q`: de 1 a 100 caracteres depois de remover espaços das pontas; busca `ILIKE %q%` em `titulo` **ou** `carta_nome`, com `%`, `_` e `\` de `q` tratados como texto literal;
- `precoMin`, `precoMax`: centavos inteiros de 0 a 10.000.000.000; `precoMin` > `precoMax` → 422 com `detalhes.campo` `precoMax`. O preço do lote é `coalesce(lance_atual_centavos, lance_inicial_centavos)`; a faixa é fechada (`precoMin ≤ preço ≤ precoMax`);
- `raridade`: um de `common`, `uncommon`, `rare`, `mythic`, `special`, `bonus`;
- `ordem`: `termina_antes` (padrão: `fim_em` crescente), `mais_recente` (`criado_em` decrescente) ou `maior_lance` (preço decrescente). Em todas, o desempate é `id` decrescente, para a paginação ser estável;
- `pagina`: inteiro de 1 a 500 (padrão 1). **24 lotes por página**; página além da última → 200 com lista vazia e o `total` real.

Os filtros se combinam com E. Resposta: `dados` = lista de `Lote` e `meta {total, pagina, limite: 24}`.

### Detalhe (`GET /api/lotes/{id}`, público com sessão opcional)
- `id` inexistente ou que não é UUID → 404 `NAO_ENCONTRADO`.
- Lote `cancelado` → 200 com `status: "cancelado"` (não 404); só a vitrine nunca lista cancelados.
- Inclui os campos do snapshot sem a imagem (`catalogo.obterSnapshot`), `imagemUrl` = `/api/imagens/{snapshotId}` e `suaPosicao`. A rota usa `@SessaoOpcional()` (specs/003): lê o cookie `access_token` se houver e for válido; ausente, inválido ou expirado → anônimo, sem 401.
- Nenhuma resposta pública (nem esta) leva nome ou e-mail de licitante nem do leiloeiro.

### Painel do leiloeiro
- `GET /api/painel/lotes?pagina=` (leiloeiro): só os lotes do próprio usuário, inclusive `cancelado`, do mais recente para o mais antigo (`criado_em` decrescente, desempate `id` decrescente); `pagina` de 1 a 500; **24 por página**; `dados` = lista de `Lote` e `meta {total, pagina, limite: 24}`. Cada `Lote` traz `valorArremateCentavos` (resultado do encerrado arrematado) e `totalLances`.
- `GET /api/painel/resumo` (leiloeiro) → `{totalRecebidoCentavos, lotesArrematados, lotesSemLance}`, contando só lotes do usuário com status **gravado** `encerrado` (gravado pelo job, specs/010): `lotesArrematados` = os que têm vencedor; `totalRecebidoCentavos` = soma dos `valor_arremate_centavos` desses; `lotesSemLance` = os com `total_lances` = 0. Sem lote encerrado, os três valem 0.

## Interfaces e contratos
- `GET /api/lotes?status=&q=&precoMin=&precoMax=&raridade=&ordem=&pagina=` (público) → 200 lista de `Lote` + `meta` · 422
- `GET /api/lotes/{id}` (público, sessão opcional) → 200 `LoteDetalhe` · 404
- `POST /api/painel/lotes` (leiloeiro) → 201 `Lote` · 401 · 403 · 422 · 503 `CATALOGO_OCUPADO` | `CATALOGO_INDISPONIVEL`
- `GET /api/painel/lotes?pagina=` (dono) → 200 lista de `Lote` + `meta` · 401 · 403 · 422 e `GET /api/painel/resumo` → `{totalRecebidoCentavos, lotesArrematados, lotesSemLance}` · 401 · 403
- `POST /api/painel/lotes/{id}/cancelamento` (dono) → 200 · 404 (lote inexistente ou de outro leiloeiro, specs/003) · 409 `LOTE_ENCERRADO`. A rota é servida por `liquidacao` (specs/010 §Cancelamento) e entra no `openapi.yaml` na F4; não faz parte do contrato da F2.

`suaPosicao` em `GET /api/lotes/{id}` usa só as colunas de `lots` (`lotes` não importa `lances`): `ganhando` (lote ao vivo e `lider_id` = usuário), `venceu` (lote encerrado e `vencedor_id` = usuário) ou `null` nos demais casos e para anônimos. As cinco posições (`ganhando`, `superado`, `venceu`, `perdeu`, `sem_lance`) vêm do ack de `entrar_lote` (specs/009) e de `GET /api/me/lances` (specs/007 §Posição do usuário no lote).

Interface interna para `liquidacao` (recebe `tx`): travar o lote com `FOR UPDATE` e devolver a linha, e mudar o status (encerrado, cancelado); `lotes` continua dono de `lots`.

## Dados
- `lots(id uuid pk, leiloeiro_id fk, snapshot_id fk, carta_nome text, raridade text, titulo, descricao, lance_inicial_centavos, incremento_minimo_centavos, inicio_em, fim_em, fim_original_em, status status_lote, lance_atual_centavos null, lider_id null, total_lances int default 0, vencedor_id null, valor_arremate_centavos null, encerrado_em null, cancelado_em null, criado_em)`
- `carta_nome` e `raridade` são copiados do snapshot na criação do lote (imutáveis, como o snapshot), para a vitrine buscar e filtrar sem JOIN com `card_snapshots` (tabela de `catalogo`). A migration é do db-dev, na F2.
- Índices: `(status, fim_em)`, `(status, inicio_em)`, `(leiloeiro_id, criado_em desc)`, trigram em `titulo` e em `carta_nome` (busca de texto por título ou carta, RF-03).
- Retenção: permanente.

## Critérios de aceite
- [ ] Lote cancelado some da vitrine e continua no painel do dono.
- [ ] Cancelar com líder devolve o comprometido ao disponível (evento `saldo_atualizado`).
- [ ] `GET /api/lotes/{id}` devolve `suaPosicao` `ganhando` para o líder do lote ao vivo, `venceu` para o vencedor do encerrado e `null` nos demais casos; com cookie inválido ou expirado responde 200 como anônimo (nunca 401).
- [ ] `GET /api/lotes/{id}` de lote cancelado → 200 com `status` `cancelado`; id inexistente ou que não é UUID → 404.
- [ ] Filtros combinados retornam o resultado correto (testes de integração): status derivado dos horários (agendado antes do início, ao vivo entre início e fim, encerrado a partir do fim mesmo com status gravado `ao_vivo`), `q` em título e em nome da carta (com `%` e `_` literais), faixa de preço por `coalesce(lance_atual, lance_inicial)`, `raridade`, cada `ordem`, com desempate por `id` decrescente (páginas sem repetição nem lacuna com valores iguais).
- [ ] Paginação: 24 lotes por página (`meta.limite` 24); `pagina` 501, `q` vazio, `q` com 101 caracteres, `precoMin` > `precoMax` e `status` desconhecido → 422 com `detalhes.campo`; página além da última → 200 com lista vazia.
- [ ] Criação: cada limite de §Criação tem um caso de fronteira (título de 120 e de 121 caracteres, descrição de 2000 e de 2001, lance de 99 e de 100 centavos, 100.000.000 e 100.000.001, início 61 s no passado, fim 299 e 300 s depois do início, duração de 7 dias e de 7 dias + 1 s); lote com início ≤ agora nasce `ao_vivo` e com início futuro nasce `agendado`.
- [ ] Falha no preparo do snapshot (Scryfall fora, imagem inválida) → 503 e nenhum `card_snapshots` nem `lots` criado; `scryfallId` inexistente → 422 com `detalhes.campo` `scryfallId`.
- [ ] `GET /api/painel/lotes` só devolve lotes do próprio leiloeiro (inclusive cancelados); `GET /api/painel/resumo` soma só encerrados com vencedor do próprio usuário.
- [ ] Nenhuma resposta de `lotes` contém nome ou e-mail de usuário (teste que varre o JSON).

## Fora de escopo
Edição de lote depois de publicado; lotes com múltiplos itens; preço de reserva; `Idempotency-Key` na criação de lote (F2).

## Decisões relacionadas
- decisions/0001-decisoes-iniciais.md, 0025-cancelamento-em-liquidacao-e-arestas-dos-modulos.md
