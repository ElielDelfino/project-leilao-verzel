# 007 — Lances e regras

Status: aprovada
Depende de: 004, 006, 008

## Requisitos (regras do PDF)
- RF-01 Lances só são aceitos em lotes ao vivo (entre início e fim).
- RF-02 O primeiro lance deve ser ≥ lance inicial; os seguintes ≥ lance atual + incremento mínimo.
- RF-03 O líder não pode cobrir o próprio lance.
- RF-04 O lance só é aceito se couber no saldo disponível; o valor do líder fica comprometido e volta ao disponível quando ele é superado.
- RF-05 Anti-sniping: lance aceito **a menos de 2 minutos do fim** (`fim_em − agora < 2 min`) estende o fim para **agora + 2 minutos** (ADR 0001, fronteira na ADR 0031). Faltando exatamente 2 minutos, ou mais, o fim não muda.
- RF-06 Leiloeiro não dá lance.
- RNF-01 p95 < 300 ms no servidor com 50 licitantes no mesmo lote.
- RNF-02 Rate limit: 10 lances/s por usuário → 429 (§Limite de tentativas).

## Comportamento
### Ordem das verificações
`POST /api/lotes/{id}/lances` com `{valorCentavos}` (inteiro; corpo sem campo desconhecido) e `Idempotency-Key` (UUID). Antes da transação, nesta ordem (ADR 0027, com a exceção de papel da ADR 0031):
1. CSRF inválido → 403 `CSRF_INVALIDO`;
2. sem sessão → 401 `NAO_AUTENTICADO`;
3. papel `leiloeiro` → 403 `LEILOEIRO_NAO_PODE_LANCAR`. A rota **não** usa o `@Papel` global (que responderia `PAPEL_NAO_PERMITIDO`): o caso de uso recusa o leiloeiro com este código;
4. validação → 422 `DADOS_INVALIDOS`: `valorCentavos` inteiro de 1 a 9007199254740991, `Idempotency-Key` ausente ou que não seja UUID;
5. limite de tentativas → 429 `MUITAS_TENTATIVAS` (§Limite de tentativas);
6. lote inexistente, ou id que não é UUID → 404 `NAO_ENCONTRADO`, por uma leitura sem lock (`obterResumos(db, [loteId])` de `lotes`; lista vazia → 404; pendência de leitura própria em specs/006), **antes** do `FOR UPDATE`.

### Transação
Uma transação, com `lock_timeout` de 5 s (contenção além disso, SQLSTATE 55P03, → 503 `INDISPONIVEL`, nunca 500):
1. `travarLote(tx, loteId)`: `SELECT ... FROM lots WHERE id = $1 FOR UPDATE`; devolve o lote travado (`LoteTravado`). Logo depois, `agora(tx)` lê o instante (§Relógio), uma única vez.
2. Idempotência (§Idempotência): se já existe lance do usuário com esta `Idempotency-Key`, a transação termina aqui, sem escrever nada.
3. Verificações, nesta ordem (primeira que falhar → 422 com o código):
   | condição | código |
   |---|---|
   | lote cancelado, ou agora ≥ `fim_em` | `LOTE_ENCERRADO` |
   | agora < `inicio_em` | `LOTE_NAO_INICIADO` |
   | `lider_id` = usuário | `JA_ESTA_GANHANDO` |
   | valor < mínimo (lance inicial se não há lance; senão lance atual + incremento) | `LANCE_ABAIXO_DO_MINIMO` (+ `detalhes.minimoCentavos`) |

   `SALDO_INSUFICIENTE` não é verificado aqui: vem só de `carteira.comprometer` (passo 6), sob o lock da carteira, depois de `LANCE_ABAIXO_DO_MINIMO`. A decisão de "ao vivo" é só por `inicio_em`, `fim_em` e `cancelado`; o status `ao_vivo` ou `encerrado` gravado não entra, porque o job de encerramento é da F4 (specs/006 §Estados). O `detalhes` leva só valores primitivos.
4. `lanceId` = UUIDv7 novo, gerado **antes** de tocar o `bids` e o ledger, porque o lançamento do ledger e o lance se referenciam por ele.
5. `lances.anexar(tx, ...)`: grava o lance em `bids` com `seq` = `total_lances` + 1, pseudônimo, hash e assinatura (specs/008), com `criadoEm` = `agora`. Vem **antes** das carteiras porque a FK `ledger_entries.lance_id → bids` (ADR 0031 D9) é imediata: um `compromisso` gravado antes do lance violaria a FK (SQLSTATE 23503) em todo lance. É uma transação só: se o passo 6 recusar, o `bids` é desfeito junto, por rollback. `lanceAnteriorId`: o `LoteTravado` não traz o id do líder; `lances` o lê em `bids` (`lote_id` e `seq` = `total_lances`) dentro da `tx`, depois do `travarLote` e antes de gravar o lance novo.
6. Carteiras, na ordem de locks da specs/004 (lote primeiro; depois as carteiras em ordem crescente de `user_id`, via `travarCarteiras(tx, ids)`, e só então as duas chamadas). O líder anterior só entra na lista quando existe: `ids` = `[usuarioId, liderAnteriorId]` com líder e só `[usuarioId]` no primeiro lance do lote, em que `lider_id` é nulo (passar `undefined` faria `ordemDeTrava` lançar TypeError). Sem líder anterior não há `liberar`: `carteira.comprometer(tx, usuarioId, valorCentavos, {loteId, lanceId})` para o novo líder e, se havia líder, `carteira.liberar(tx, liderAnteriorId, lanceAnteriorCentavos, {loteId, lanceId: lanceAnteriorId})`. `SALDO_INSUFICIENTE` vem só de `carteira.comprometer`, sob o lock da carteira do licitante: a API captura `ErroDeCarteira` apenas para traduzir em 422 (`ErroDeCarteira.disponivel` → `detalhes.disponivelCentavos`) e relança para a transação dar rollback; nunca segue para o commit. A recusa desfaz tudo, inclusive o `bids` do passo 5 e a liberação.
7. `lances` calcula o fim novo (anti-sniping): `agora + 2 min` se `fim_em − agora < 2 min`, senão o fim não muda. Depois chama `registrarLance(tx, loteId, {valorCentavos, liderId, novoFimEm?})`, que atualiza `lance_atual_centavos`, `lider_id`, `total_lances` (+1) e, só quando `novoFimEm` vem, `fim_em` (`greatest`, nunca antes do fim atual: o CHECK `fim_em ≥ fim_original_em` e a regra de que o fim só avança valem). `fim_original_em` não muda. A interface está em specs/006 §Interface interna para `lances`.
8. COMMIT → publica os eventos (§Eventos).

### Relógio
"Agora" é o relógio do Postgres dentro da transação, nunca o do cliente: `agora(tx)` (`clock_timestamp()` do Postgres, já como `Date`, com precisão de milissegundo, truncado e nunca arredondado) lido **uma única vez**, depois do lock do lote (`travarLote`), e usado nas verificações, em `criado_em` do lance (a forma assinada, specs/008) e no cálculo do novo `fim_em`.

### Idempotência
Unique `(licitante_id, idempotency_key)` em `bids`. Dentro da transação, depois do lock do lote e antes das verificações de recusa (para a repetição de um lance aceito não virar `JA_ESTA_GANHANDO`), procura-se o lance do usuário com a chave:
- mesmo lote e mesmo `valorCentavos` → **200** com o `lance` original e o `lote` atual (`lanceAtualCentavos`, `fimEm` e `totalLances` de agora), sem lance, lançamento, evento nem extensão novos;
- outro lote ou outro valor → 422 `DADOS_INVALIDOS` (mesmo código do depósito, ADR 0022).

Recusas não gravam a chave: repetir a chave de um lance recusado reavalia as regras. Toda repetição conta no limite de tentativas.

### Limite de tentativas
RNF-02: 10 lances/s por usuário. O `LimiteDeTentativas` recebe janela e limite como parâmetros (ADR 0031): janela fixa de 1 s, limite 10, chave `ratelimit:lance:{userId}`. Conta toda tentativa com corpo válido (passo 4), inclusive as recusadas e as repetições, e roda antes da transação, sem pegar o lock do lote. Estourou: 429 `MUITAS_TENTATIVAS` com `Retry-After: 1`. Redis fora: 500 `INDISPONIVEL` (falha fechada), como no login (specs/003 §Rate limit).

### Eventos
Publicados só depois do COMMIT (specs/009), pelo barramento interno:
- `lance_aceito` → rooms `lote:{id}` e `vitrine`;
- `fim_estendido` → `lote:{id}` e `vitrine`, só quando o fim mudou;
- `voce_foi_superado` → `usuario:{liderAnteriorId}`, só se havia líder anterior;
- `saldo_atualizado` → `usuario:{id}` do novo líder e do líder anterior (com o saldo devolvido por `comprometer` e `liberar`).

### Posição do usuário no lote
Calculada por `lances` (`bids` do próprio módulo + colunas de `lots` lidas pela interface de `lotes`). Valores (ADR 0025):

| posição | condição |
|---|---|
| `ganhando` | lote ao vivo e `lider_id` = usuário |
| `superado` | lote ao vivo, usuário com ao menos um lance no lote e `lider_id` ≠ usuário |
| `venceu` | lote encerrado e `vencedor_id` = usuário |
| `perdeu` | usuário com ao menos um lance no lote e o lote encerrado com outro vencedor ou cancelado |
| `sem_lance` | usuário sem lance no lote (inclui lote agendado) |

Lote com `fim_em` vencido, status derivado `encerrado` e `vencedor_id` nulo (até o job de encerramento da F4 gravar o vencedor): `ganhando` para o líder (`lider_id` = usuário) e `perdeu` para quem tem lance e não é o líder; quando o job gravar o vencedor, vale a linha `venceu`/`perdeu` normal.

Onde aparece: `GET /api/me/lances` (`posicao`, sempre um dos quatro valores com lance) e o ack de `entrar_lote` (`suaPosicao`, specs/009). `GET /api/lotes/{id}` não chama `lances`: devolve só `ganhando` ou `venceu`, das colunas de `lots` (specs/006).

## Interfaces e contratos
Operações do `openapi.yaml` 0.5.0 (ADR 0031):
- `POST /api/lotes/{id}/lances` (`lancesAceitar`, licitante) `{valorCentavos}` + `Idempotency-Key` → 201 `{lance, lote: {lanceAtualCentavos, fimEm, totalLances}}`; 200 na repetição idempotente (mesma forma); 401 `NAO_AUTENTICADO`; 403 `CSRF_INVALIDO` ou `LEILOEIRO_NAO_PODE_LANCAR`; 404 `NAO_ENCONTRADO`; 422 `DADOS_INVALIDOS`, `LOTE_ENCERRADO`, `LOTE_NAO_INICIADO`, `JA_ESTA_GANHANDO`, `LANCE_ABAIXO_DO_MINIMO` (`detalhes.minimoCentavos`) ou `SALDO_INSUFICIENTE` (`detalhes.disponivelCentavos`); 429 `MUITAS_TENTATIVAS` (`Retry-After: 1`); 503 `INDISPONIVEL`. O `lance` devolvido é `{seq, pseudonimo, valorCentavos, criadoEm}`: nunca o `id` interno nem dado do licitante.
- `GET /api/lotes/{id}/lances?pagina=` (`lancesListarDoLote`, público, pseudonimizado) → 200 `dados` = lances `{seq, pseudonimo, valorCentavos, criadoEm}` por `seq` decrescente, **50 por página**, `pagina` de 1 a 500 (padrão 1; além da última, 200 com lista vazia e o `total` real), `meta {total, pagina, limite: 50}`; 404 se o lote não existe; 422 `DADOS_INVALIDOS` com `detalhes.campo` `pagina`. `Cache-Control: no-store` (lote ao vivo).
- `GET /api/me/lances?pagina=` (`meLancesListar`, licitante) → 200 `dados` = um item por lote em que o usuário deu lance: `{lote, posicao, meuMaiorLanceCentavos, meuUltimoLanceEm}`, em que `lote` é o resumo `Lote` (specs/006, vindo de `obterResumos(db, ids)` de `lotes`, que não garante ordem: `lances` reordena) e `posicao` é `ganhando` | `superado` | `venceu` | `perdeu` (§Posição do usuário no lote). Ordem: `meuUltimoLanceEm` decrescente, desempate `lote.id` decrescente. **24 por página**, `pagina` de 1 a 500, `meta {total, pagina, limite: 24}`. 401 `NAO_AUTENTICADO`; 403 `PAPEL_NAO_PERMITIDO` (leiloeiro); 422 `DADOS_INVALIDOS`. `Cache-Control: no-store`.

## Dados
- `bids(id uuid pk, lote_id fk, seq int, licitante_id fk, pseudonimo text, valor_centavos bigint, criado_em timestamptz(3), hash_anterior bytea, hash bytea, assinatura bytea, key_id text, idempotency_key uuid)`; unique `(lote_id, seq)`, unique `(licitante_id, idempotency_key)`; trigger append-only.
- Retenção: permanente.

## Critérios de aceite
- [ ] Cada um dos 6 códigos de recusa tem teste de integração.
- [ ] A posição devolvida segue a tabela de §Posição do usuário no lote nos cinco casos (teste de integração, um por valor) e no caso do `fim_em` vencido sem `vencedor_id`: `ganhando` para o líder e `perdeu` para os demais com lance.
- [ ] Recusa por `SALDO_INSUFICIENTE` desfaz o lance: nenhum `bids`, lançamento, extensão nem evento novos, e `detalhes.disponivelCentavos` vem de `ErroDeCarteira.disponivel`.
- [ ] Primeiro lance do lote, sem líder anterior (`lider_id` nulo): aceito, `travarCarteiras` só com o licitante, `comprometer` sem `liberar` e sem erro.
- [ ] 50 lances simultâneos no mesmo lote: seq contígua, sem dois líderes, ledger reconciliado.
- [ ] Lance a 1 min do fim estende para agora + 2 min; lance a 3 min e a exatamente 2 min não estendem.
- [ ] Leiloeiro → 403 `LEILOEIRO_NAO_PODE_LANCAR`; anônimo → 401; lote inexistente ou id que não é UUID → 404 antes do `FOR UPDATE`.
- [ ] Idempotência: repetir a chave com o mesmo lote e valor → 200 com o lance original, sem lance, lançamento nem evento novos; outro valor ou outro lote, header ausente ou que não é UUID → 422 `DADOS_INVALIDOS`.
- [ ] 11 lances em 1 s do mesmo usuário: o 11º → 429 `MUITAS_TENTATIVAS` com `Retry-After: 1`; Redis fora → 500 `INDISPONIVEL`.
- [ ] Contenção de lock além de 5 s → 503 `INDISPONIVEL`, nunca 500.
- [ ] Dois lotes cruzados (X lidera o lote 2 e Y o lote 1; cada um dá lance no lote do outro ao mesmo tempo) não dão deadlock (specs/004 §Comportamento).
- [ ] `GET /api/lotes/{id}/lances` pagina de 50 em 50 por `seq` decrescente e `GET /api/me/lances` de 24 em 24; nenhuma resposta pública traz nome, e-mail ou id de usuário.

## Fora de escopo
Lance automático (proxy bidding), lance por WebSocket.

## Decisões relacionadas
- decisions/0003-monolito-modular.md, 0004-tempo-real-socketio-e-lance-rest.md, 0031-complementos-da-f3.md
