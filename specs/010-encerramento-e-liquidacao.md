# 010 — Encerramento e liquidação

Status: aprovada
Depende de: 004, 006, 007, 008

## Requisitos
- RF-01 Ao encerrar: debita o vencedor, credita o leiloeiro e gera o comprovante. Lote sem lances fecha sem vencedor.
- RF-02 Agendado vira ao vivo no horário de início.
- RNF-01 Latência de encerramento ≤ 1 s após `fim_em`.
- RNF-02 Seguro com N instâncias da API (sem liquidar duas vezes).

## Comportamento
Job interno (`@nestjs/schedule`, intervalo de 1 s) em cada instância:
1. Início: `UPDATE lots SET status='ao_vivo' WHERE id IN (SELECT id FROM lots WHERE status='agendado' AND inicio_em <= now() FOR UPDATE SKIP LOCKED LIMIT 50) RETURNING id` → evento `lote_iniciado`.
2. Fim: `SELECT id FROM lots WHERE status='ao_vivo' AND fim_em <= now() FOR UPDATE SKIP LOCKED LIMIT 20`; para cada lote, uma transação:
   - com líder: `carteira.debitarArremate(vencedor)`, `carteira.creditarArremate(leiloeiro)`, cria o `receipt`, grava o selo (specs/008), status `encerrado`, vencedor e valor;
   - sem lances: selo com `totalLances = 0`, status `encerrado`;
   - COMMIT → eventos `lote_encerrado` e `lote_arrematado`.
- A operação é idempotente: só processa `status='ao_vivo'`.
- Um lance que chega depois de `fim_em` mas antes do job é recusado (`LOTE_ENCERRADO`), porque a regra de lance usa o horário (specs/006).

## Interfaces e contratos
Interno; eventos em specs/009.

## Dados
- `receipts(id uuid pk, lote_id unique fk, codigo_publico text unique, vencedor_id fk, vencedor_pseudonimo, valor_centavos, hash_final, assinatura_selo, emitido_em)`
- `codigo_publico`: 16 caracteres base62 aleatórios (~95 bits), usado no link compartilhável.
- Retenção: permanente.

## Critérios de aceite
- [ ] Duas instâncias da API rodando o job ao mesmo tempo nunca liquidam o mesmo lote duas vezes (teste de integração).
- [ ] Após o encerramento: o vencedor perdeu o valor no total e no comprometido, o leiloeiro ganhou no total, e o ledger está reconciliado.

## Decisões relacionadas
- decisions/0008-encerramento-por-varredura.md
