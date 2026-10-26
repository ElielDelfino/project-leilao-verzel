# 004 — Carteira (ledger)

Status: aprovada
Depende de: 001, 003

## Contexto
O PDF define: disponível = total − comprometido; o valor do líder fica comprometido e volta ao disponível assim que ele é superado; o lance só é aceito se couber no disponível. Um ledger append-only torna cada centavo rastreável.

## Requisitos
- RF-01 O licitante vê total, comprometido e disponível, e faz depósitos simulados.
- RF-02 O leiloeiro vê o total recebido (créditos de arremate); ele não deposita (403 `PAPEL_NAO_PERMITIDO`, specs/003). Saldo e extrato ficam abertos aos dois papéis.
- RF-03 Depósito entre R$ 1,00 e R$ 100.000,00 por operação, com `Idempotency-Key` (UUID).
- RF-04 Extrato paginado com 20 lançamentos por página, do mais recente para o mais antigo.
- RNF-01 Valores em centavos (`bigint`). Nenhuma operação deixa o comprometido > total, nem negativo (CHECK no banco).
- RNF-02 A projeção `wallet_balances` é sempre igual à soma do ledger (teste de reconciliação no CI).

## Comportamento
Tipos de lançamento e efeito na projeção:

| tipo | quando | total | comprometido |
|---|---|---|---|
| `deposito` | depósito simulado | +v | — |
| `compromisso` | licitante passa a liderar um lote | — | +v |
| `liberacao` | licitante é superado | — | −v |
| `estorno` | lote cancelado com o licitante na liderança | — | −v |
| `debito_arremate` | liquidação, vencedor | −v | −v |
| `credito_arremate` | liquidação, leiloeiro | +v | — |

- Toda alteração acontece na transação de quem a causa (lance, liquidação, cancelamento), pela interface pública `carteira.*(tx, ...)`, que trava a linha de `wallet_balances` com `FOR UPDATE`.
- Interface do lance (ADR 0031), com `tx` da transação do lote:
  - `carteira.comprometer(tx, userId, valorCentavos, {loteId, lanceId})`: trava a carteira do usuário, recusa com `ErroDeCarteira` `SALDO_INSUFICIENTE` (campos `valor` e `disponivel`) se `disponível < valor`, grava `compromisso` (com `lote_id` e `lance_id`) e soma ao comprometido;
  - `carteira.liberar(tx, userId, valorCentavos, {loteId, lanceId})`: grava `liberacao` e subtrai do comprometido; o `lanceId` é o do lance **superado**;
  - as duas devolvem o saldo novo (`{totalCentavos, comprometidoCentavos, disponivelCentavos}`), que alimenta `saldo_atualizado` (specs/009). `lanceId` é gerado por `lances` antes de chamá-las (specs/007), porque o lançamento aponta para o lance, e o `bids` já está gravado quando elas rodam (a FK `lance_id → bids` é imediata, ADR 0031 D9).
  - `ReferenciaDoLance` = `{loteId, lanceId}`. `ErroDeCarteira` (erro de domínio, não HTTP) tem `codigo` `SALDO_INSUFICIENTE` (de `comprometer`), `COMPROMETIDO_INSUFICIENTE` (de `liberar`, bug de quem chama), `LANCE_JA_PROCESSADO` ou `LIQUIDACAO_JA_PROCESSADA` (esta última na interface da liquidação, abaixo) e os campos `valor`, `disponivel` e `comprometido` (os dois últimos conforme o código). Quem chama traduz: `disponivel` vira `detalhes.disponivelCentavos` na resposta da API. `ErroDeCarteira` exige rollback da `tx`: nunca capturar e seguir para o commit.
  - Para travar mais de uma carteira na mesma transação (lance que supera outro licitante, liquidação), o jeito prescrito é `travarCarteiras(tx, userIds)`, que trava em ordem crescente de `user_id` (`ordemDeTrava`: minúsculas, sem repetidos) e devolve um `ReadonlyMap<string, SaldoEmCentavos>`: chaves são os `user_id` em minúsculas (os mesmos de `ordemDeTrava`, sem repetidos) e cada valor é `{ total, comprometido }`, em centavos inteiros (sem `disponivel`; ele é `total − comprometido`); só depois vêm `comprometer` e `liberar`.
- Ordem de locks para evitar deadlock: lote primeiro, depois carteiras em ordem crescente de `user_id` (ADR 0031). Em um lance há duas carteiras (novo líder e líder anterior): **quem chama (`lances`) trava as duas com `travarCarteiras`** (ordem crescente de `user_id`) antes das duas chamadas; `comprometer` e `liberar` não reordenam. Caso cruzado: X lidera o lote 2 e Y lidera o lote 1, e cada um dá lance no lote do outro; sem a ordem, `comprometer(X)` e `liberar(Y)` pediriam os locks em ordens opostas. A mesma ordem vale na liquidação (`travarCarteiras(tx, [vencedor, leiloeiro])` depois do lock do lote) e no cancelamento (`travarCarteiras(tx, [lider])`); `estornar`, `debitarArremate` e `creditarArremate` também não reordenam (ADR 0032, specs/010).
- Interface da liquidação e do cancelamento (ADR 0032), com `tx` da transação do lote e a mesma `ReferenciaDoLance` (`{loteId, lanceId}`, em que `lanceId` é o lance do **líder**):
  - `carteira.estornar(tx, userId, valorCentavos, ref)`: grava `estorno` e subtrai do comprometido do líder; usada só pelo cancelamento (specs/010);
  - `carteira.debitarArremate(tx, vencedorId, valorCentavos, ref)`: grava `debito_arremate` e subtrai do total **e** do comprometido do vencedor;
  - `carteira.creditarArremate(tx, leiloeiroId, valorCentavos, ref)`: grava `credito_arremate` e soma ao total do leiloeiro (cria a linha de `wallet_balances` dele no primeiro crédito, regra abaixo);
  - as três devolvem o saldo novo como `comprometer` e `liberar`; valor que não é inteiro positivo → `RangeError` antes de tocar o banco; `estornar` e `debitarArremate` recusam com `COMPROMETIDO_INSUFICIENTE` se `comprometido < valor`. O valor vem sempre do `compromisso` lido sob o lock do lote (`lance_atual_centavos` do lote travado), nunca do cliente.
  - Os três lançamentos gravam `lote_id` e `lance_id`, e o índice único parcial `ledger_entries_lote_id_tipo_unico` (D4, §Dados) impede que o mesmo lote seja estornado, debitado ou creditado duas vezes.
- Erros de domínio de unicidade repetida (violação 23505, traduzida pelo código e pelo nome da restrição, sem `cause`, valor, saldo, SQL nem `detail` do driver; a `tx` já está abortada no Postgres e quem chama só faz rollback, sem ler saldo nem gravar nada): `LANCE_JA_PROCESSADO` (`comprometer` ou `liberar` repetidos para o mesmo `lance_id` e tipo; índice `ledger_entries_lance_id_tipo_unico`) e `LIQUIDACAO_JA_PROCESSADA` (`estornar`, `debitarArremate` ou `creditarArremate` repetidos para o mesmo `lote_id` e tipo). Nenhum dos dois leva `valor` nem `disponivel`.
- A linha de `wallet_balances` de um usuário **nasce no primeiro lançamento dele** (para o licitante, o primeiro depósito; para o leiloeiro, o primeiro `credito_arremate`), na mesma transação do lançamento e sob o mesmo bloqueio, por `INSERT ... ON CONFLICT (user_id) DO UPDATE`; o cadastro (`identidade`) não escreve em tabela de `carteira` (ADR 0027). Sem linha, o saldo é zero: `GET /api/carteira` → 200 com os três valores em 0.
- Extrato: uma `pagina` além da última não é erro: 200 com `dados: []` e `meta` com o `total` real; só `pagina` menor que 1 ou não inteira é 422.
- Saldo insuficiente → `ErroDeCarteira` `SALDO_INSUFICIENTE` com `disponivel`, traduzido pela API em `detalhes.disponivelCentavos`.
- Idempotência do depósito, por `(user_id, idempotency_key)`: repetir a chave com o mesmo corpo responde 200 com o mesmo lançamento e o saldo atual; repetir a chave com corpo diferente responde 422 `DADOS_INVALIDOS`. Nos dois casos, nenhum lançamento novo é gravado.
- Corpo com campo desconhecido → 422 `DADOS_INVALIDOS`.

## Interfaces e contratos
- `GET /api/carteira` → 200 `{totalCentavos, comprometidoCentavos, disponivelCentavos}` · 401
- `POST /api/carteira/depositos` `{valorCentavos}` + `Idempotency-Key` → 201 `{lancamento, saldo}` · 200 (repetição) · 401 · 403 `CSRF_INVALIDO` ou `PAPEL_NAO_PERMITIDO` · 422 `DADOS_INVALIDOS`
- `GET /api/carteira/extrato?pagina=` → 200 `[{id, tipo, valorCentavos, loteId, criadoEm}]` + `meta {total, pagina, limite: 20}` · 401 · 422
- Evento Socket.IO pessoal `saldo_atualizado` (specs/009).

## Dados
- `ledger_entries(id uuid pk, user_id fk, tipo tipo_lancamento, valor_centavos bigint check > 0, lote_id null fk → lots, lance_id null fk → bids, idempotency_key null, criado_em)` (as duas FKs entram na migration da tarefa 073, ADR 0031 D9; a FK para `bids` é imediata, por isso o lance é gravado em `bids` antes do `compromisso` e do `liberacao` na transação do lance, specs/007); unique `(user_id, idempotency_key)`; índice único parcial `ledger_entries_lote_id_tipo_unico` em `(lote_id, tipo)` onde `tipo in ('estorno','debito_arremate','credito_arremate')` e `lote_id is not null` (D4, ADR 0032; migration da tarefa 102), que não afeta `compromisso` nem `liberacao`; trigger bloqueia UPDATE/DELETE; o papel da API só tem SELECT e INSERT (specs/014 §Papéis do Postgres).
- `wallet_balances(user_id pk, total_centavos bigint, comprometido_centavos bigint, atualizado_em)`; `CHECK (comprometido_centavos >= 0 AND comprometido_centavos <= total_centavos)`.
- Retenção: permanente.

## Critérios de aceite
- [ ] Ser superado devolve o valor ao disponível na mesma transação do novo lance.
- [ ] Depósito repetido com a mesma `Idempotency-Key` e o mesmo corpo → 200 com o mesmo lançamento; com corpo diferente → 422; em ambos, um único lançamento no ledger.
- [ ] Leiloeiro em `POST /api/carteira/depositos` → 403 `PAPEL_NAO_PERMITIDO`.
- [ ] Usuário recém-cadastrado, sem lançamentos: `wallet_balances` não tem linha dele, `GET /api/carteira` → 200 com total, comprometido e disponível iguais a 0 e `GET /api/carteira/extrato` → 200 com `dados: []` e `meta.total` 0; depois do primeiro depósito de R$ 10,00, existe exatamente uma linha com total 1000 (teste de integração).
- [ ] Extrato com 21 lançamentos: `pagina=2` → 1 item, `pagina=3` → 200 com `dados: []` e `meta.total` 21; `pagina=0` e `pagina=abc` → 422 (teste de integração).
- [ ] 50 lances concorrentes do mesmo licitante em lotes diferentes nunca deixam o comprometido acima do total.
- [ ] Lotes cruzados (X lidera o lote 2, Y lidera o lote 1, cada um dá lance no lote do outro ao mesmo tempo, repetido 20 vezes): nenhum deadlock (nenhum SQLSTATE 40P01) e ledger reconciliado.
- [ ] `comprometer` com `disponível < valor` recusa com `SALDO_INSUFICIENTE` e não grava lançamento; `comprometer` e `liberar` gravam `lote_id` e `lance_id` no lançamento.
- [ ] `estornar`, `debitarArremate` e `creditarArremate` gravam `lote_id` e `lance_id`; depois de estorno, o comprometido do líder cai e o ledger reconcilia; depois de débito e crédito, o vencedor perde o valor no total e no comprometido, o leiloeiro ganha no total (a linha dele nasce no primeiro crédito) e o ledger reconcilia; `comprometido < valor` em `estornar` ou `debitarArremate` recusa sem gravar lançamento.
- [ ] Segundo `estornar`, `debitarArremate` ou `creditarArremate` do mesmo lote → `ErroDeCarteira` `LIQUIDACAO_JA_PROCESSADA` (sem `valor`); segundo `comprometer` ou `liberar` do mesmo lance → `LANCE_JA_PROCESSADO`; nos dois casos nenhum lançamento novo e o saldo igual.
- [ ] Teste de reconciliação: projeção == Σ ledger para todos os usuários após a suíte e2e.

## Fora de escopo
Saque, pagamento real, moedas diferentes de BRL.

## Decisões relacionadas
- decisions/0007-carteira-ledger-append-only.md, 0022-complementos-auth-e-idempotencia.md, 0026-papeis-do-postgres.md (privilégios de `ledger_entries` e `wallet_balances`), 0027-complementos-da-f1.md, 0031-complementos-da-f3.md (ordem dos locks e FKs de `lote_id` e `lance_id`), 0032-complementos-da-f4.md (lançamentos de liquidação, índice único e `LIQUIDACAO_JA_PROCESSADA`)
