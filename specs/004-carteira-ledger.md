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
- Ordem de locks para evitar deadlock: lote primeiro, depois carteiras em ordem crescente de `user_id`.
- Saldo insuficiente → erro de domínio `SALDO_INSUFICIENTE` com `disponivelCentavos`.
- Idempotência do depósito, por `(user_id, idempotency_key)`: repetir a chave com o mesmo corpo responde 200 com o mesmo lançamento e o saldo atual; repetir a chave com corpo diferente responde 422 `DADOS_INVALIDOS`. Nos dois casos, nenhum lançamento novo é gravado.
- Corpo com campo desconhecido → 422 `DADOS_INVALIDOS`.

## Interfaces e contratos
- `GET /api/carteira` → 200 `{totalCentavos, comprometidoCentavos, disponivelCentavos}` · 401
- `POST /api/carteira/depositos` `{valorCentavos}` + `Idempotency-Key` → 201 `{lancamento, saldo}` · 200 (repetição) · 401 · 403 `CSRF_INVALIDO` ou `PAPEL_NAO_PERMITIDO` · 422 `DADOS_INVALIDOS`
- `GET /api/carteira/extrato?pagina=` → 200 `[{id, tipo, valorCentavos, loteId, criadoEm}]` + `meta {total, pagina, limite: 20}` · 401 · 422
- Evento Socket.IO pessoal `saldo_atualizado` (specs/009).

## Dados
- `ledger_entries(id uuid pk, user_id fk, tipo tipo_lancamento, valor_centavos bigint check > 0, lote_id null, lance_id null, idempotency_key null, criado_em)`; unique `(user_id, idempotency_key)`; trigger bloqueia UPDATE/DELETE.
- `wallet_balances(user_id pk, total_centavos bigint, comprometido_centavos bigint, atualizado_em)`; `CHECK (comprometido_centavos >= 0 AND comprometido_centavos <= total_centavos)`.
- Retenção: permanente.

## Critérios de aceite
- [ ] Ser superado devolve o valor ao disponível na mesma transação do novo lance.
- [ ] Depósito repetido com a mesma `Idempotency-Key` e o mesmo corpo → 200 com o mesmo lançamento; com corpo diferente → 422; em ambos, um único lançamento no ledger.
- [ ] Leiloeiro em `POST /api/carteira/depositos` → 403 `PAPEL_NAO_PERMITIDO`.
- [ ] 50 lances concorrentes do mesmo licitante em lotes diferentes nunca deixam o comprometido acima do total.
- [ ] Teste de reconciliação: projeção == Σ ledger para todos os usuários após a suíte e2e.

## Fora de escopo
Saque, pagamento real, moedas diferentes de BRL.

## Decisões relacionadas
- decisions/0007-carteira-ledger-append-only.md, 0022-complementos-auth-e-idempotencia.md
