# 010 — Encerramento e liquidação

Status: aprovada
Depende de: 004, 006, 007, 008

## Requisitos
- RF-01 Ao encerrar: debita o vencedor, credita o leiloeiro e gera o comprovante. Lote sem lances fecha sem vencedor.
- RF-02 Agendado vira ao vivo no horário de início.
- RF-03 O cancelamento de lote (specs/006 RF-04) é executado por este módulo, numa transação, com estorno do líder e selo `cancelado`.
- RNF-01 Latência de encerramento ≤ 2 s após `fim_em` (p95): até 1 s de espera pela próxima varredura, mais a transação. É meta de demo (ADR 0014); a varredura continua de 1 s (ADR 0008). A ADR 0032 (D2) registra a mudança da meta anterior de 1 s, que a varredura sozinha já ocuparia inteira (specs/000 RNF-10).
- RNF-02 Seguro com N instâncias da API (sem liquidar duas vezes).

## Comportamento
Agendador interno em cada instância da API (`@nestjs/schedule`, dependência de produção aprovada na ADR 0032 D1, intervalo de 1 s; ADR 0008). Regras do agendador:
- **Sem sobreposição:** se o tick anterior ainda não terminou, o seguinte é pulado; o desligamento da API espera o tick em andamento.
- **Ligado só no processo real:** o `main.ts` o liga depois do `listen`; os testes o ligam apenas quando o teste é sobre ele.
- **Falha fechada:** só começa depois de a chave de assinatura estar registrada (specs/008 §Chaves; sem ela a API nem sobe).
- **Erro isolado:** o erro em um lote é registrado (só o `loteId` e o nome do erro) e o tick segue para o próximo; erro de banco não derruba o processo.
- **Lote "veneno" (backoff por lote):** um lote cujo encerramento falha sempre (por exemplo, selo divergente do lote travado, que é erro de integridade) ocuparia o `LIMIT 20` da varredura para sempre e atrasaria os demais. Cada instância mantém **em memória** um contador de falhas consecutivas por `loteId`; depois de cada falha o lote é **excluído da seleção** (passo 2) por um tempo crescente: 2 s, 4 s, 8 s e assim por diante, dobrando até o teto de 60 s. Um encerramento bem-sucedido ou a saída do lote da seleção (já encerrado por outra instância) zera o contador. Na **primeira** falha de um lote (e só nela, não a cada tick) a instância registra um alerta de log distinto, `LOTE_COM_FALHA_DE_ENCERRAMENTO`, só com `loteId` e o nome do erro, para a operação perceber; as falhas seguintes são registradas como o erro comum. O estado é por processo e some na reinicialização (o lote volta a ser tentado de imediato, com o contador zerado); nenhum dado novo vai para o banco. Enquanto a causa não for corrigida, o lote veneno continua sem selo nem recibo, mas não atrasa os outros.

Cada tick faz, nesta ordem:
1. **Início.** `UPDATE lots SET status='ao_vivo' WHERE id IN (SELECT id FROM lots WHERE status='agendado' AND inicio_em <= now() FOR UPDATE SKIP LOCKED LIMIT 50) RETURNING id`; depois do COMMIT, um `lote_iniciado` por lote.
2. **Candidatos ao fim.** `SELECT id FROM lots WHERE status='ao_vivo' AND fim_em <= now() AND id <> ALL($1) ORDER BY fim_em LIMIT 20`, **sem lock**: um `FOR UPDATE SKIP LOCKED` solto perderia o lock no autocommit. `$1` é a lista, em memória, dos lotes em backoff (§Lote "veneno"; vazia na maior parte do tempo).
3. **Encerramento**, uma transação por candidato, em sequência, com os passos nesta ordem (lote antes das carteiras, specs/004):
   1. trava o lote com `SELECT ... FOR UPDATE SKIP LOCKED` e **reconfere sob o lock** `status='ao_vivo'` e `fim_em <= clock_timestamp()`. Sem linha (travado por outra instância, já encerrado, ou com o fim estendido pelo anti-sniping depois da varredura) → pula, sem efeito;
   2. `agora(tx)`, lido uma vez;
   3. `lances.selar(tx, ...)` com status `encerrado` (specs/008), que devolve o selo gravado;
   4. com líder: `carteira.travarCarteiras(tx, [vencedor, leiloeiro])` (ordem crescente de `user_id`), `carteira.debitarArremate(vencedor)`, `carteira.creditarArremate(leiloeiro)` e a criação do `receipt`, com `hash_final`, `assinatura_selo`, `key_id` e `selado_em` do selo devolvido no passo 3;
   5. status `encerrado`, `vencedor_id`, `valor_arremate_centavos` e `encerrado_em` (interface de `lotes`).
- **Conferência antes de gravar:** o pseudônimo e o valor do selo correspondem ao líder e ao `lance_atual_centavos` do lote travado; divergência é erro de integridade, com rollback e log só com o `loteId`.
- **Sem lances:** selo com `totalLances = 0` (hash da gênese) e status `encerrado`, sem vencedor, sem lançamento, sem recibo e sem tocar na carteira do leiloeiro.
- **Perdedores:** nenhum lançamento extra. Só o líder tem `compromisso` ativo; os demais foram liberados quando superados (specs/007). Depois do encerramento, o comprometido ligado ao lote é 0 para todos.
- **Atomicidade:** o lote nunca fica sem selo nem com selo sem encerramento; selo ou recibo duplicado (unique de `lot_seals` ou de `receipts`) e lançamento de liquidação duplicado (`LIQUIDACAO_JA_PROCESSADA`, índice `ledger_entries_lote_id_tipo_unico`, ADR 0032 D4 e specs/004) viram erro de domínio, com rollback. O débito, o crédito e o estorno gravam `lote_id` e `lance_id` (o lance do líder) no lançamento.
- **Idempotência:** só se processa `status='ao_vivo'`; um lote já encerrado nunca é liquidado de novo.
- Um lance que chega depois de `fim_em` mas antes do job é recusado (`LOTE_ENCERRADO`), porque a regra de lance usa o horário (specs/006). Um lance que entra antes de o job travar o lote é coberto pelo selo; nunca há selo defasado.
- `liquidacao` não lê nem escreve `lots` nem lê `lot_seals`: as consultas e atualizações do lote passam pela interface de `lotes` (specs/006 §Interfaces), que recebe a `tx`, e os dados do selo vêm do retorno de `lances.selar`.

### Eventos (depois do COMMIT)
Nenhum evento sai antes do COMMIT, e rollback não publica nada. Os payloads estão em specs/009 e no `asyncapi.yaml`; nenhum payload público leva nome, e-mail nem id de usuário.

| evento | destino | quando |
|---|---|---|
| `lote_iniciado` | `lote:{id}` e `vitrine` | início do lote |
| `lote_encerrado` | `lote:{id}` e `vitrine` | encerramento; com `vencedorPseudonimo` e `valorArremateCentavos` se houve vencedor |
| `lote_arrematado` | `usuario:{vencedor}` | encerramento com vencedor, com `codigoComprovante` |
| `saldo_atualizado` | `usuario:{vencedor}` e `usuario:{leiloeiro}` | encerramento com vencedor, com os saldos lidos na transação |
| `lote_cancelado` | `lote:{id}` e `vitrine` | cancelamento |
| `saldo_atualizado` | `usuario:{líder}` | cancelamento de lote com líder |

Se o processo cair entre o COMMIT e a publicação, os clientes se recuperam no resync (specs/009).

### Cancelamento (ADR 0025, complementada pela 0032)
`POST /api/painel/lotes/{id}/cancelamento` (dono; rota de specs/006, servida por este módulo; `openapi.yaml` 0.6.0). Antes da transação: CSRF (403), sessão (401), papel (403 `PAPEL_NAO_PERMITIDO`) e `id` que não é UUID (404). Uma transação com `SET LOCAL lock_timeout = '5s'` e `SET LOCAL statement_timeout = '10s'` (os dois valem só dentro da transação), nesta ordem de locks (specs/004):
1. Trava o lote com `FOR UPDATE` (interface de `lotes`). Lote inexistente ou de outro leiloeiro → 404 `NAO_ENCONTRADO`; `encerrado` ou `cancelado` gravado → 409 `LOTE_ENCERRADO`; **`agora(tx)` ≥ `fim_em` → 409 `LOTE_ENCERRADO`**, pois o status derivado já é `encerrado` (specs/006): o lote vencido que o job ainda não processou é liquidado, não cancelado.
2. Com líder: `carteira.travarCarteiras(tx, [lider])` e `carteira.estornar(tx, lider, valor, {loteId, lanceId})` (lançamento `estorno` com `lote_id` e `lance_id` do lance do líder, comprometido −v). O `valor` é o `compromisso` do líder lido sob o lock do lote (`lance_atual_centavos` do lote travado); o corpo da requisição não existe e nenhum valor vem do cliente.
3. `lances.selar(tx, ...)` com status `cancelado` (specs/008; `totalLances` e `hashFinal` do histórico até ali).
4. Muda o status para `cancelado` e grava `cancelado_em` (interface de `lotes`).
5. COMMIT → eventos `lote_cancelado` e, se havia líder, `saldo_atualizado` para ele (specs/009). A resposta é 200 com o `Lote` (status `cancelado`), lido por `obterResumos` depois do COMMIT.

Lote agendado ou sem lances: sem líder, sem estorno; o selo `cancelado` tem `totalLances = 0`. Repetir o cancelamento depois do sucesso → 409. Contenção de lock além de 5 s (`lock_timeout`, SQLSTATE 55P03) ou consulta além de 10 s (`statement_timeout`, SQLSTATE 57014) → rollback e 503 `INDISPONIVEL` sem `detalhes`, nunca 500, como no lance (specs/007); a resposta não diz qual dependência falhou. Falha em qualquer passo desfaz tudo: nunca há lote cancelado sem selo nem estorno sem cancelamento.

## Interfaces e contratos
- `POST /api/painel/lotes/{id}/cancelamento` → 200 `Lote` · 401 · 403 · 404 · 409 `LOTE_ENCERRADO` · 503 (acima).
- `GET /api/comprovantes/{codigo}` e `GET /api/me/arremates`: lê `receipts`; contrato em specs/011 e no `openapi.yaml`.
- Eventos: specs/009 (tabela acima).

## Dados
- `receipts(id uuid pk, lote_id unique fk, codigo_publico text unique, vencedor_id fk, vencedor_pseudonimo, valor_centavos, hash_final, assinatura_selo, key_id, selado_em, emitido_em)`. Um recibo por lote arrematado; lote sem lance ou cancelado não tem recibo.
- `hash_final`, `assinatura_selo`, `key_id` e `selado_em` são cópias do selo de `lot_seals` (dono: `lances`), gravadas na emissão para o comprovante não ler a tabela de outro módulo. `vencedor_pseudonimo` e `valor_centavos` também são os do selo.
- Append-only: trigger contra UPDATE e DELETE e papel da API só com SELECT e INSERT (ADR 0026).
- A coerência entre `receipts` e `lot_seals` (mesmo `hash_final`, `assinatura_selo`, `key_id`, `selado_em`, pseudônimo e valor) não tem FK nem trigger entre os dois módulos: é garantida por código (o recibo é montado só com o retorno de `lances.selar`, passo 3 e 4 do encerramento) e por teste de integração (tarefa 105).
- `codigo_publico`: 16 caracteres base62 aleatórios (~95 bits), gerados por `crypto.randomBytes` com **amostragem por rejeição** para não haver viés: cada byte sorteado só vale se for menor que 248 (o maior múltiplo de 62 até 256, 4 × 62); o valor é `byte % 62` sobre o alfabeto `0-9A-Za-z`, e os bytes rejeitados são descartados e sorteados de novo até completar 16 caracteres. Nada de `Math.random` nem de `byte % 62` direto. Em colisão do unique de `codigo_publico` (23505 nessa restrição, praticamente impossível), a emissão gera um código novo e tenta de novo, até 3 vezes, dentro da mesma transação (um `SAVEPOINT` por tentativa, para o 23505 não abortar a transação inteira); esgotadas as tentativas, é erro de integridade com rollback, como qualquer falha do encerramento. Colisão no unique de `lote_id` não se repete: é recibo duplicado (§Atomicidade).
- Retenção: permanente.

## Critérios de aceite
- [ ] Cancelar um lote com líder, numa única transação: o líder recupera o comprometido (ledger reconciliado), o selo `cancelado` existe e o status é `cancelado`; uma falha forçada no selo ou no estorno deixa lote, ledger e selos como estavam (teste de integração).
- [ ] Cancelar um lote com `fim_em` vencido que o job ainda não encerrou, um `encerrado` e um `cancelado` → 409 `LOTE_ENCERRADO`; lote de outro leiloeiro e inexistente → 404 (teste de integração).
- [ ] Duas instâncias da API rodando o job ao mesmo tempo nunca liquidam o mesmo lote duas vezes: um débito, um crédito, um recibo e um selo (teste de integração).
- [ ] Após o encerramento: o vencedor perdeu o valor no total e no comprometido, o leiloeiro ganhou no total, o recibo existe, o comprometido ligado ao lote é 0 para todos os licitantes e o ledger está reconciliado.
- [ ] Lote sem lances: selo com total 0, status `encerrado`, nenhum lançamento e nenhum recibo.
- [ ] Falha forçada no selo, no crédito ou no recibo deixa lote, ledger, selos e recibos como estavam, e nenhum evento sai.
- [ ] Lote com o fim estendido pelo anti-sniping depois da varredura e antes do lock não é encerrado.
- [ ] Um lote vencido é encerrado em até 2 s (p95 medido, RNF-01) e o `lote_iniciado` sai para o lote agendado cujo início chegou.
- [ ] Lote "veneno": com um lote cujo encerramento falha sempre (selo divergente forçado) e 20 ou mais lotes vencidos saudáveis, os saudáveis são encerrados nos ticks seguintes; o veneno sai da seleção com tempo crescente (2 s, 4 s, 8 s, teto de 60 s, relógio simulado), o alerta `LOTE_COM_FALHA_DE_ENCERRAMENTO` sai uma única vez por lote e sem dados além de `loteId` e do nome do erro, e o contador volta a zero depois de um encerramento bem-sucedido (teste de integração com relógio simulado).
- [ ] Cancelamento com contenção: com o lote travado por outra transação por mais de 5 s, o cancelamento responde 503 `INDISPONIVEL` sem `detalhes`, com rollback (nenhum estorno, selo ou mudança de status); o estorno grava o `compromisso` lido sob o lock (`lance_atual_centavos`), mesmo que o corpo da requisição traga um valor (teste de integração).
- [ ] `codigo_publico`: 16 caracteres de `[0-9A-Za-z]`, gerados por `crypto.randomBytes` com rejeição de bytes ≥ 248 (teste de unidade com `randomBytes` simulado que devolve bytes rejeitáveis e confere que são descartados); colisão simulada no unique tenta de novo até 3 vezes e a quarta colisão desfaz o encerramento (teste de unidade/integração).
- [ ] Coerência de `receipts` com `lot_seals` (mesmo `hash_final`, `assinatura_selo`, `key_id`, `selado_em`, pseudônimo e valor) depois de um encerramento com vencedor (teste de integração da tarefa 105).
- [ ] Os eventos de §Eventos saem só depois do COMMIT, com o destino da tabela; nenhum payload tem nome, e-mail nem id de usuário (teste que varre o JSON).

## Decisões relacionadas
- decisions/0008-encerramento-por-varredura.md, 0014-rnfs-de-demo.md, 0025-cancelamento-em-liquidacao-e-arestas-dos-modulos.md, 0032-complementos-da-f4.md
