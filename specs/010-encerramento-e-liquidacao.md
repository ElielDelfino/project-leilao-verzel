# 010 — Encerramento e liquidação

Status: aprovada
Depende de: 004, 006, 007, 008

## Requisitos
- RF-01 Ao encerrar: debita o vencedor, credita o leiloeiro e gera o comprovante. Lote sem lances fecha sem vencedor.
- RF-02 Agendado vira ao vivo no horário de início.
- RF-03 O cancelamento de lote (specs/006 RF-04) é executado por este módulo, numa transação, com estorno do líder e selo `cancelado`.
- RNF-01 Latência de encerramento ≤ 1 s após `fim_em`.
- RNF-02 Seguro com N instâncias da API (sem liquidar duas vezes).

## Comportamento
Job interno (`@nestjs/schedule`, intervalo de 1 s) em cada instância:
1. Início: `UPDATE lots SET status='ao_vivo' WHERE id IN (SELECT id FROM lots WHERE status='agendado' AND inicio_em <= now() FOR UPDATE SKIP LOCKED LIMIT 50) RETURNING id` → evento `lote_iniciado`.
2. Fim: `SELECT id FROM lots WHERE status='ao_vivo' AND fim_em <= now() FOR UPDATE SKIP LOCKED LIMIT 20`; para cada lote, uma transação:
   - com líder: `carteira.debitarArremate(vencedor)`, `carteira.creditarArremate(leiloeiro)`, cria o `receipt`, grava o selo com `lances.selar` (specs/008), status `encerrado`, vencedor e valor;
   - sem lances: selo com `totalLances = 0`, status `encerrado`;
   - COMMIT → eventos `lote_encerrado` e `lote_arrematado`.
- A operação é idempotente: só processa `status='ao_vivo'`.
- Um lance que chega depois de `fim_em` mas antes do job é recusado (`LOTE_ENCERRADO`), porque a regra de lance usa o horário (specs/006).
- `liquidacao` não lê nem escreve `lots`: as consultas e atualizações acima passam pela interface de `lotes` (specs/006 §Interfaces), que recebe a `tx`.

### Cancelamento (ADR 0025)
`POST /api/painel/lotes/{id}/cancelamento` (dono; rota de specs/006, servida por este módulo). Uma transação, nesta ordem de locks (specs/004):
1. Trava o lote com `FOR UPDATE` (interface de `lotes`). Lote inexistente ou de outro leiloeiro → 404; `encerrado` ou `cancelado` → 409 `LOTE_ENCERRADO`.
2. Com líder: `carteira.estornar(tx, lider, valor)` (lançamento `estorno`, comprometido −v).
3. `lances.selar(tx, ...)` com status `cancelado` (specs/008; `totalLances` e `hashFinal` do histórico até ali).
4. Muda o status para `cancelado` e grava `cancelado_em` (interface de `lotes`).
5. COMMIT → eventos `lote_cancelado` e, se havia líder, `saldo_atualizado` para ele (specs/009). Se o processo cair entre o COMMIT e a publicação, os clientes se recuperam no resync.

Falha em qualquer passo desfaz tudo: nunca há lote cancelado sem selo nem estorno sem cancelamento.

## Interfaces e contratos
Interno; eventos em specs/009.

## Dados
- `receipts(id uuid pk, lote_id unique fk, codigo_publico text unique, vencedor_id fk, vencedor_pseudonimo, valor_centavos, hash_final, assinatura_selo, emitido_em)`
- `codigo_publico`: 16 caracteres base62 aleatórios (~95 bits), usado no link compartilhável.
- Retenção: permanente.

## Critérios de aceite
- [ ] Cancelar um lote com líder, numa única transação: o líder recupera o comprometido (ledger reconciliado), o selo `cancelado` existe e o status é `cancelado`; uma falha forçada no selo ou no estorno deixa lote, ledger e selos como estavam (teste de integração).
- [ ] Duas instâncias da API rodando o job ao mesmo tempo nunca liquidam o mesmo lote duas vezes (teste de integração).
- [ ] Após o encerramento: o vencedor perdeu o valor no total e no comprometido, o leiloeiro ganhou no total, e o ledger está reconciliado.

## Decisões relacionadas
- decisions/0008-encerramento-por-varredura.md, 0025-cancelamento-em-liquidacao-e-arestas-dos-modulos.md
