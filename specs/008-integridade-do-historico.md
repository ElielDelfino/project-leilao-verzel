# 008 — Integridade do histórico

Status: aprovada
Depende de: 001

## Contexto
Qualquer alteração, remoção ou inserção posterior no histórico, mesmo direto no banco, deve ser detectada pela auditoria. A técnica precisa ser explicada no README.

## Técnica (ADR 0005)
**Hash chain por lote + assinatura Ed25519 por lance + selo assinado no encerramento.**

- Forma canônica do lance: JSON canonicalizado (RFC 8785/JCS, ADR 0031) de `{loteId, seq, pseudonimo, valorCentavos, criadoEm, hashAnterior}`; a forma exata está em §Forma canônica e vetor de teste.
- `hash = SHA-256(canônico em UTF-8)`. Gênese: `hashAnterior = SHA-256("leilao-verzel:genesis:" + loteId)` em hex minúsculo.
- `assinatura = Ed25519(chavePrivada, hash)`, sobre os 32 bytes do hash (não sobre o texto hex). A chave privada **existe só no ambiente da API** (em produção, no `.env.local` do servidor, entregue à API em arquivo: specs/014 §Segredos), nunca no banco; `key_id` identifica a chave para permitir rotação (§Chaves).
- Selo (`lot_seals`) gerado quando o lote é encerrado ou cancelado: canônico (§Forma canônica e vetor de teste) de `{loteId, status, totalLances, hashFinal, vencedorPseudonimo, valorArremateCentavos, seladoEm}`, assinado como o lance (Ed25519 sobre os 32 bytes de SHA-256(canônico)). O selo vai no comprovante. É gravado por `lances.selar(tx, ...)`, chamado por `liquidacao` na mesma transação do encerramento ou do cancelamento (specs/010). `selar` exige o lote já travado (`FOR UPDATE`) na `tx` e confere o lote travado contra a cadeia lida na mesma `tx`: mesmo `loteId`, status `encerrado` só sobre lote `ao_vivo`, e `total_lances`, `lance_atual_centavos` e líder do lote travado iguais a `seq`, valor e pseudônimo do último lance (ou 0, nulo e nulo sem lances); divergência → recusa `LOTE_DIVERGENTE` e um segundo selo do lote → `SELO_JA_GRAVADO` (PK de `lot_seals`), nos dois casos sem gravar e com rollback de quem chama. Devolve o selo gravado e o `ultimoLanceId` (o id do último lance, `null` sem lances), que `liquidacao` usa como `lanceId` do `estorno` e dos lançamentos do arremate sem ler `bids` (specs/010, ADR 0035).
- Pseudônimo: `"Licitante #" + hex(HMAC-SHA256(PSEUDONYM_HMAC_KEY, loteId + ":" + userId))[0..6]`. É estável dentro do lote e diferente entre lotes, então não dá para ligar um licitante entre lotes.
- Defesa adicional: triggers impedem UPDATE/DELETE em `bids`, `lot_seals` e `signing_keys` (um superusuário pode removê-los, e a detecção continua valendo, com o limite de §Limitações conhecidas).

## Forma canônica e vetor de teste
Uma só forma para a API e para o navegador (ADR 0031). O canônico é o `JSON.stringify` do objeto com as chaves em ordem alfabética, sem espaços; todos os valores são strings ASCII ou inteiros seguros (ou `null`), então o resultado é igual ao da JCS (RFC 8785) sem biblioteca.

- **Lance:** chaves `criadoEm`, `hashAnterior`, `loteId`, `pseudonimo`, `seq`, `valorCentavos`.
  - `criadoEm`: ISO 8601 UTC com exatamente 3 casas de milissegundo e `Z` (`2026-10-27T14:03:07.120Z`, a forma de `Date.prototype.toISOString`). Vem de `agora(tx)` (`clock_timestamp()` do Postgres, specs/006 §Interface interna para `lances`) lido uma única vez na transação do lance (specs/007) e é o mesmo valor gravado em `bids.criado_em`: truncado, nunca arredondado, para a coluna `timestamptz(3)` guardar exatamente o que foi assinado.
  - `hashAnterior`: 64 caracteres hex minúsculos; `seq` e `valorCentavos`: números inteiros; `loteId`: UUID em minúsculas.
- **Selo:** chaves `hashFinal`, `loteId`, `seladoEm`, `status` (`encerrado` ou `cancelado`), `totalLances`, `valorArremateCentavos`, `vencedorPseudonimo`. `valorArremateCentavos` e `vencedorPseudonimo` valem `null` (JSON `null`, a chave continua presente) em lote cancelado ou sem lance. `hashFinal` é o `hash` do último lance, ou o hash da gênese se `totalLances` for 0. `seladoEm` segue o formato de `criadoEm`.
- **Codificações:** `hash` e `hashAnterior` em hex minúsculo (64 caracteres); `assinatura` em base64url sem padding (86 caracteres para 64 bytes); `chavePublica` como em §Chaves.

Vetor de teste (RFC 8032 §7.1 TEST 1, de §Chaves; `loteId` `0198f3c0-7b1a-7c00-8000-000000000001`). Todo valor abaixo foi calculado com `node:crypto` e a assinatura verificada com a chave pública; o Ed25519 é determinístico, então a API e o navegador devem reproduzir os mesmos bytes.

- Gênese: `hashAnterior` do lance 1 = `82842ba46c36a8e7ea4d91bab2695ec3281f83824f6b9c91af66cbaef0423585`.
- Lance 1 (`pseudonimo` `Licitante #3fa9c1`, `valorCentavos` 15000, `criadoEm` `2026-10-27T14:03:07.120Z`):
  - canônico: `{"criadoEm":"2026-10-27T14:03:07.120Z","hashAnterior":"82842ba46c36a8e7ea4d91bab2695ec3281f83824f6b9c91af66cbaef0423585","loteId":"0198f3c0-7b1a-7c00-8000-000000000001","pseudonimo":"Licitante #3fa9c1","seq":1,"valorCentavos":15000}`
  - hash: `af1bac38780142da599db0996414d71a5a5b98ad198b2c0c8f7a1bf55abdd8cb`
  - assinatura: `MOumYMXLSRf1yq3BzD9MT4kPV0kMPUFw4cUEvbCd-u90psSijUKdOoE4nO9hy__a9mAzFP3ygg-RNp5DNRDyDQ`
- Lance 2 (`pseudonimo` `Licitante #b04e7d`, `valorCentavos` 16500, `criadoEm` `2026-10-27T14:03:41.907Z`, `hashAnterior` = hash do lance 1):
  - canônico: `{"criadoEm":"2026-10-27T14:03:41.907Z","hashAnterior":"af1bac38780142da599db0996414d71a5a5b98ad198b2c0c8f7a1bf55abdd8cb","loteId":"0198f3c0-7b1a-7c00-8000-000000000001","pseudonimo":"Licitante #b04e7d","seq":2,"valorCentavos":16500}`
  - hash: `70110ba5cbdcbd8f62e443939427c9182717a6273e4b5b2bea997034a5427e93`
  - assinatura: `RK6Z6YI2HbG7BDQuSctvl2AXor2Bxwyw5m-BPPTSK_bVMhNBUw9rSqJuFYrbltWJOQaZ-tMGB9U3QzvtFfiDAA`
- Os vetores do RFC 8785 que o subconjunto cobre (ordem das chaves, inteiros, strings ASCII, `null`) entram no teste de unidade da canonicalização.

## Chaves (ADR 0023)
Formatos que a API, o seed e a verificação no navegador leem. Origem de cada variável em specs/014 §Segredos.

- `ED25519_PRIVATE_KEY`: seed Ed25519 de 32 bytes (RFC 8032 §5.1.5) em base64url canônico sem padding (43 caracteres). A API decodifica, recusa no boot o que não tiver 32 bytes ou cuja recodificação em base64url não reproduza o mesmo texto (specs/014 §Leitura), e deriva a chave pública (32 bytes, RFC 8032 §5.1.5). A chave pública não é configurada.
- `keyId` (coluna `key_id` de `bids` e `lot_seals`): os 16 primeiros caracteres hex minúsculos de SHA-256(chave pública de 32 bytes). É derivado pela API no boot; não existe variável `ED25519_KEY_ID`.
- `chavePublica` em `GET /api/auditoria/chaves`: os 32 bytes da chave pública em base64url sem padding (43 caracteres).
- `PSEUDONYM_HMAC_KEY`: 32 bytes aleatórios em base64url canônico sem padding (43 caracteres); a chave do HMAC-SHA256 do pseudônimo são os 32 bytes decodificados, não o texto. A API recusa no boot o que não decodificar para 32 bytes ou cuja recodificação não reproduza o mesmo texto.
- Vetor de teste (RFC 8032 §7.1, TEST 1): seed `9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60` (base64url `nWGxne_9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A`) → chave pública `11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo` → `keyId` `21fe31dfa154a261`.
- **Chaves públicas antigas (ADR 0031, fecha a pendência da ADR 0023):** a tabela `signing_keys(key_id pk, chave_publica bytea, ativa_desde timestamptz)` guarda toda chave pública que já assinou. No boot, depois de derivar a chave pública e o `keyId`, a API faz `INSERT ... ON CONFLICT (key_id) DO NOTHING` da chave ativa; `ativa_desde` é o instante (`clock_timestamp()`) do primeiro registro, e uma reinicialização com a mesma chave não o altera. Se o registro falhar, a API não sobe (nenhum lance é assinado com uma chave que ninguém consegue verificar). A tabela é append-only (trigger e privilégios só SELECT e INSERT, ADR 0026). `GET /api/auditoria/chaves` lê a tabela, ordenada por `ativaDesde` crescente (desempate `keyId`), então rotacionar `ED25519_PRIVATE_KEY` mantém verificáveis os lances e selos assinados com as chaves anteriores. O vetor de teste de §Forma canônica e vetor de teste usa essa chave.
- **Rotação de `PSEUDONYM_HMAC_KEY` (ADR 0031):** não rotacionar com lote aberto (agendado ou ao vivo). Os pseudônimos já gravados em `bids` seguem válidos, mas o `seuPseudonimo` calculado com a chave nova deixaria de bater com o do líder na sala. A regra é operacional e entra no README; a API não a impede.

## Verificação
A auditoria recalcula e reporta cada problema com o `seq`:
1. seq contígua de 1 a n (detecta remoção no meio e inserção fora de ordem);
2. cada `hashAnterior` = `hash` do lance anterior (detecta alteração e inserção);
3. cada `hash` = SHA-256(canônico) (detecta alteração de campo);
4. cada assinatura válida com a chave pública de `key_id`, publicada em `signing_keys`; um `key_id` sem chave publicada também é problema (detecta recálculo da cadeia por quem não tem a chave);
5. se selado: total e hash final iguais aos do selo, e assinatura do selo válida (detecta truncamento no fim).

Veredito: `integro` se tudo passar; senão `adulterado` + lista de problemas. Cada problema é `{codigo, seq, mensagem}` (`seq` é `null` nos problemas do selo), e o servidor e o navegador usam os mesmos códigos:

| passo | código |
|---|---|
| 1 | `SEQ_FORA_DE_ORDEM` |
| 2 | `HASH_ANTERIOR_DIVERGENTE` |
| 3 | `HASH_DIVERGENTE` |
| 4 | `ASSINATURA_INVALIDA`, `CHAVE_DESCONHECIDA` |
| 5 | `SELO_TOTAL_DIVERGENTE`, `SELO_HASH_FINAL_DIVERGENTE`, `SELO_ASSINATURA_INVALIDA` |

Detalhes dos códigos:
- **Entrada de `verificarCadeia`:** `{loteId, lances, selo, chaves}`. O `loteId` faz parte da entrada porque não está gravado em `bids` (a linha só tem o lote por FK) e entra no canônico de cada lance e do selo, além do hash da gênese; um `loteId` que não seja UUID em minúsculas é erro de quem chama (exceção), não problema da cadeia. O navegador usa a mesma entrada, com o `loteId` da rota.
- **`CHAVE_DESCONHECIDA`** (passo 4): o `key_id` do lance não está na lista de chaves publicadas. Por SQL ela é inalcançável, porque `bids.key_id` tem FK para `signing_keys` e uma linha com `key_id` inexistente nem chega a ser gravada; só aparece se a lista de chaves recebida estiver incompleta (por exemplo, o navegador com uma lista velha, o motivo da nova consulta de `GET /api/auditoria/chaves`). Por isso é coberta só em teste de unidade de `verificarCadeia`, não em integração.
- **`SELO_ASSINATURA_INVALIDA`** (passo 5): vale também quando o `keyId` do selo não tem chave publicada (o selo não tem código próprio de chave desconhecida), além de assinatura que não confere ou canônico do selo que não pode ser recalculado.

Um lote sem lances e sem selo é `integro`; com selo, vale o passo 5 contra `totalLances` 0 e o hash da gênese. A verificação roda no servidor **e no navegador** (WebCrypto SHA-256 + `@noble/ed25519`), com a chave pública em `GET /api/auditoria/chaves`.

## Limitações conhecidas (vão para o README)
- Antes do selo (lote ao vivo), alguém com acesso ao banco pode apagar os **últimos** lances e ajustar a linha do lote; sem âncora externa, isso não é detectável pela verificação da cadeia: a cadeia que sobra continua contígua, encadeada e assinada, e a linha do lote ajustada não contradiz nada. Sinal barato, **não** prova: se o `totalLances` de um `lance_aceito` que um cliente conectado recebeu (specs/009) for maior que o número de lances que a auditoria devolve, lances sumiram. Mitigação parcial: os clientes conectados viram os hashes ao vivo. Âncora externa (OpenTimestamps) ficou fora (ADR 0005).
- Quem tiver a chave privada E acesso ao banco pode forjar o histórico; por isso a chave fica separada do banco.
- Como as chaves públicas ficam em `signing_keys` (ADR 0031), quem tiver escrita no banco acima do papel da API (superusuário ou dono, que também pode desligar os triggers) pode registrar uma chave própria, reassinar uma cadeia forjada e passar na verificação. A detecção vale contra quem altera `bids` sem poder inserir em `signing_keys`. Contra o dono do banco, a âncora é externa: o comprovante do vencedor (specs/011) carrega `hashFinal`, `keyId` e a assinatura do selo, e uma cadeia reassinada muda o `hashFinal`.

- **Verificação no navegador sem âncora externa:** ela recalcula hashes, assinaturas e selo com a chave pública que o **próprio servidor** publica em `GET /api/auditoria/chaves`. Prova a **consistência interna** (a cadeia confere consigo mesma e com aquela chave), não que a chave seja a verdadeira: quem controla o servidor e a chave publicada também controla o que o navegador verifica. A tela mostra o `keyId` (o fingerprint da chave pública, §Chaves) da chave usada, e o fingerprint é publicado **fora do servidor** (README e release, F5, specs/014) para o visitante comparar (specs/012 §Auditoria). A âncora externa de verdade continua sendo o comprovante do vencedor (item anterior).
- **Teto de 1000 lances na auditoria pública:** um lote com mais de 1000 lances recebe 503 `INDISPONIVEL` em `GET /api/auditoria/lotes/{id}` e fica sem auditoria pública: sem veredito do servidor e sem verificação no navegador. A cadeia nunca é truncada, porque um veredito sobre parte dela seria falso. O limite protege a rota, que recalcula a cadeia inteira a cada consulta e, com o Redis fora, fica sem rate limit. Os lances acima do teto continuam aceitos, assinados e encadeados; o selo e o comprovante do vencedor seguem válidos. O teto, o `statement_timeout` de 5 s e o contador único `ratelimit:auditoria:global` estão em specs/011 §Rate limit e §Teto da cadeia e tempo das consultas.

## Interfaces e contratos
- `GET /api/auditoria/lotes/{id}` (público; operationId `auditoriaDoLote`): lote, lances (seq, pseudônimo, valor, criadoEm, hashAnterior, hash, assinatura, keyId), selo, veredito do servidor. **Devolve a cadeia inteira, sem paginação** (ADR 0031): o navegador precisa de todos os lances para recalcular a cadeia. Acima de 1000 lances, a resposta é 503 `INDISPONIVEL`, nunca uma cadeia truncada; os comandos da leitura têm `statement_timeout` de 5 s, local à transação (specs/011 §Teto da cadeia e tempo das consultas). Lote inexistente, ou id que não é UUID → 404 `NAO_ENCONTRADO`; lote cancelado ou sem lances tem auditoria (cadeia vazia, veredito `integro`). A resposta nunca é cacheada (`Cache-Control: no-store`): o veredito reflete o banco no momento da consulta, inclusive depois do selo. Tem rate limit (429 `MUITAS_TENTATIVAS` com `Retry-After` e `no-store`): teto global de 600 requisições por minuto, contado junto com `GET /api/auditoria/chaves`, até a tarefa 020 (`trustProxy`, F5); 60 por minuto por IP depois, com falha aberta se o Redis cair (specs/011 §Rate limit). O 404 de id inexistente ou malformado vem antes do contador e não o consome.
- `GET /api/auditoria/chaves` (público; operationId `auditoriaChaves`): `[{keyId, algoritmo: "Ed25519", chavePublica (base64url), ativaDesde}]`, lido de `signing_keys`. `Cache-Control: public, max-age=60` (só no 200; o 429 sai com `no-store`, e o contador é o mesmo da rota acima, specs/011 §Rate limit); o navegador que encontrar um `keyId` ausente da lista refaz a consulta uma vez antes de acusar problema.
- Script de demonstração `pnpm demo:adulterar --lote <id> --seq <n>` (só dev/demo): altera um lance via SQL desabilitando o trigger, para mostrar a detecção.

## Dados
- Colunas de integridade em `bids` (specs/007).
- `lot_seals(lote_id pk, status, total_lances, hash_final, vencedor_pseudonimo, valor_arremate_centavos, selado_em, assinatura, key_id)`
- `signing_keys(key_id pk, chave_publica bytea, ativa_desde timestamptz)`, append-only (migration da tarefa 073; §Chaves).
- Retenção: permanente.

## Critérios de aceite
- [ ] Testes para cada adulteração: alterar valor, apagar o lance do meio, inserir lance, recalcular a cadeia sem a chave, truncar o fim de um lote selado. Todas detectadas.
- [ ] Verificação no navegador e no servidor dão o mesmo veredito.
- [ ] Com o vetor de teste de §Chaves, a API deriva a chave pública e o `keyId` indicados (teste de unidade).
- [ ] Com o vetor de §Forma canônica e vetor de teste, a API reproduz o canônico, o hash e a assinatura dos lances 1 e 2, e o navegador (WebCrypto + `@noble/ed25519`) valida os mesmos (teste de unidade nos dois lados; o do navegador entra na F4).
- [ ] Rotação: com duas linhas em `signing_keys`, `GET /api/auditoria/chaves` publica as duas, ordenadas por `ativaDesde`, e a auditoria de um lote assinado com a chave antiga continua `integro`; subir de novo com a mesma chave não cria linha nem muda `ativaDesde` (teste de integração).
- [ ] Rate limit das rotas de auditoria (specs/011): a 601ª requisição em um minuto ao contador de `GET /api/auditoria/lotes/{id}` e `GET /api/auditoria/chaves` → 429 com `Retry-After` e `Cache-Control: no-store`; id inexistente ou malformado → 404 sem consumir o contador; Redis fora → resposta normal (falha aberta). Teto de 1000 lances e `statement_timeout`: critérios de specs/011.
- [ ] A API não sobe com `ED25519_PRIVATE_KEY` ou `PSEUDONYM_HMAC_KEY` que não decodifique para 32 bytes ou cuja recodificação difira do texto; a mensagem cita só o nome (teste de unidade do env).

## Decisões relacionadas
- decisions/0005-integridade-hash-chain-ed25519.md, 0023-segredos-em-arquivo-e-formatos.md, 0031-complementos-da-f3.md
