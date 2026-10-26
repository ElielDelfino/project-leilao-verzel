# 009 — Tempo real

Status: aprovada
Depende de: 001, 006, 007

## Requisitos
- RF-01 A sala atualiza lance atual, histórico, posição, contagem regressiva e "ganhando/superado" sem recarregar.
- RF-02 A vitrine atualiza o lance atual e o status dos cards visíveis.
- RNF-01 Um lance aceito aparece nos outros clientes em < 1 s (p95).
- RNF-02 50 conexões por lote e 200 no total numa instância da API na VPS de produção (specs/014, ADR 0033).

## Comportamento
- Socket.IO 4.8, namespace `/leilao`, **só transporte websocket** (sem long-polling, dispensando sticky session). Adapter Redis para escalar horizontalmente no futuro. Dependências de produção aprovadas na ADR 0031 (D3): `socket.io`, `@nestjs/websockets`, `@nestjs/platform-socket.io`, `@socket.io/redis-adapter`.
- Handshake autenticado pelo cookie `access_token` (specs/003); sem cookie, ou com cookie inválido ou expirado, = anônimo (só leitura, nunca erro). A origem do handshake é checada contra `WEB_ORIGIN`.
- Rooms: `lote:{id}` (público), `vitrine` (público, ADR 0031) e `usuario:{id}` (privado, entrada automática quando autenticado). Anônimo não entra em room privado.
- Cliente → servidor:
  - `entrar_lote {loteId}` com ack (§Ack de `entrar_lote`); `sair_lote {loteId}`, sem ack;
  - `entrar_vitrine` e `sair_vitrine`, **sem payload e sem ack** (ADR 0031). Entrar duas vezes é inofensivo.
  - Payload inválido (`loteId` que não é UUID, campo desconhecido) em `entrar_lote` → ack de erro `DADOS_INVALIDOS`; nos eventos sem ack, é ignorado e logado sem dado sensível.
- Eventos só são publicados **depois do COMMIT** (barramento interno, specs/001). Se o processo cair entre o COMMIT e a publicação, o cliente se recupera no resync.
- Reconexão: o cliente refaz `entrar_lote` e substitui o estado local (resync). Se nenhum evento chegar em 30 s numa sala ao vivo, o cliente faz um resync preventivo.
- Ordem e repetição de `lance_aceito` (por `seq`): o cliente ignora `lance_aceito` com `seq` menor ou igual ao do lance mais recente do estado local (repetido ou já refletido num resync), sem mudar o estado nem anunciar. Se `seq` for maior que o último + 1 (lacuna: algum evento se perdeu; sem lances, o último é 0), o cliente não aplica o evento e faz `entrar_lote` imediato (resync), sem esperar os 30 s.
- Limites: 50 conexões por lote (`entrar_lote` acima disso → ack de erro `SALA_CHEIA`) e 200 no total (a 201ª conexão é recusada no handshake com `connect_error` de mensagem `SERVIDOR_CHEIO`).
- Limites por socket, contra cliente que abusa (o `asyncapi.yaml` não tem código próprio para eles, então reusam os do ack):
  - **Teto de rooms de lote:** no máximo 10 rooms `lote:{id}` por socket. `entrar_lote` do 11º lote distinto → ack `DADOS_INVALIDOS` (mensagem "Você já acompanha o máximo de lotes ao mesmo tempo."); refazer `entrar_lote` de um lote em que o socket já está (resync) não conta para o teto e nunca é recusado por ele. Os rooms `vitrine` e `usuario:{id}` não contam.
  - **Eventos por segundo:** no máximo 20 eventos do cliente por socket em janela fixa de 1 s (todos os eventos de §Cliente → servidor). `entrar_lote` acima disso → ack `INDISPONIVEL`; nos eventos sem ack, o excedente é ignorado e logado uma vez por socket, sem dado sensível.
  - **`entrar_lote` por segundo:** no máximo **5 `entrar_lote` por socket por segundo** (cada um monta o estado no banco), contados também dentro dos 20 eventos; acima disso → ack `INDISPONIVEL`. Um cliente que reconecta e refaz `entrar_lote` de poucos lotes fica dentro do limite; o cliente que passar do limite tenta de novo depois de 1 s.

### Ack de `entrar_lote`
O ack é o objeto `{sucesso: true, estado}` ou `{sucesso: false, erro: {codigo, mensagem}}`, com `codigo` em `DADOS_INVALIDOS`, `NAO_ENCONTRADO` (lote inexistente), `SALA_CHEIA` ou `INDISPONIVEL`. O socket só entra no room `lote:{id}` quando o ack é de sucesso.

`estado` = `{lote, ultimosLances, agoraServidor, seuPseudonimo?, suaPosicao?}` (schema `Estado` do `asyncapi.yaml`):
- `lote`: `{id, status, inicioEm, fimEm, fimOriginalEm, lanceInicialCentavos, incrementoMinimoCentavos, lanceAtualCentavos, totalLances, valorArremateCentavos}`. `status` é o derivado dos horários (specs/006 §Estados e status derivado); `lanceAtualCentavos` e `valorArremateCentavos` valem `null` quando não há;
- `ultimosLances`: até 50 lances `{seq, pseudonimo, valorCentavos, criadoEm}` por `seq` decrescente, os mesmos campos de `GET /api/lotes/{id}/lances`;
- `agoraServidor`: instante do servidor, lido na montagem do estado; o cliente corrige a contagem regressiva por ele;
- `seuPseudonimo`: só para autenticado, **sempre** devolvido, mesmo sem lances (é função pura do HMAC, specs/008; ADR 0031 D8). O cliente o compara com o pseudônimo do líder para mostrar "ganhando/superado";
- `suaPosicao`: só para autenticado; uma de `ganhando` | `superado` | `venceu` | `perdeu` | `sem_lance` (specs/007 §Posição do usuário no lote).

`tempo-real` monta o estado com `lotes` (lote), `lances` (últimos lances, pseudônimo e posição) e `identidade` (autenticação do handshake), só pelas interfaces públicas. O estado nunca leva nome, e-mail nem id de usuário.

### Vitrine
O servidor republica no room `vitrine` os mesmos eventos de lote, com o mesmo payload: `lance_aceito`, `fim_estendido`, `lote_iniciado`, `lote_encerrado` e `lote_cancelado`. O cliente atualiza no cache da lista o lance atual e o fim dos cards visíveis; `lote_iniciado`, `lote_encerrado` e `lote_cancelado` invalidam a lista (o lote muda de aba). O resync da vitrine é refazer a consulta `GET /api/lotes` (na reconexão), sem ack de estado.

## Interfaces e contratos
`eventbus/socketio/asyncapi.yaml` (AsyncAPI 3, versão 0.3.0). Servidor → cliente:

| evento | room | payload | fase |
|---|---|---|---|
| `lance_aceito` | `lote:{id}` e `vitrine` | `{loteId, seq, pseudonimo, valorCentavos, criadoEm, fimEm, totalLances}` | F3 |
| `fim_estendido` | `lote:{id}` e `vitrine` | `{loteId, fimEm}` (só quando o fim mudou, specs/007 RF-05) | F3 |
| `voce_foi_superado` | `usuario:{id}` do líder anterior | `{loteId, valorCentavos}`: `valorCentavos` é o valor do novo lance atual, que superou o dele | F3 |
| `saldo_atualizado` | `usuario:{id}` | `{totalCentavos, comprometidoCentavos, disponivelCentavos}`, para o novo líder e o anterior depois de um lance | F3 |
| `lote_iniciado` | `lote:{id}` e `vitrine` | `{loteId}` | F4 |
| `lote_encerrado` | `lote:{id}` e `vitrine` | `{loteId, vencedorPseudonimo?, valorArremateCentavos?}` | F4 |
| `lote_cancelado` | `lote:{id}` e `vitrine` | `{loteId}` (publicado por `liquidacao` depois do COMMIT do cancelamento, specs/010) | F4 |
| `lote_arrematado` | `usuario:{id}` | `{loteId, codigoComprovante}` | F4 |

A F3 emite só os quatro eventos do lance. O publicador interno e o contrato já tipam os oito, para a F4 não mudar o `asyncapi.yaml` por causa deles; `saldo_atualizado` também sai nos estornos e liquidações da F4.

Cliente → servidor (mesmo arquivo, operações de ação `receive`): `entrar_lote` (com o ack acima), `sair_lote`, `entrar_vitrine` e `sair_vitrine`.

## Dados
Nenhum dado persistido.

## Critérios de aceite
- [ ] Teste e2e com dois navegadores: B supera A e A vê "você foi superado" em < 1 s.
- [ ] Derrubar a conexão e voltar resulta em estado idêntico ao do servidor.
- [ ] O ack de `entrar_lote` valida contra o schema `Estado` do `asyncapi.yaml` nos cinco valores de `suaPosicao`; anônimo recebe o estado sem `seuPseudonimo` nem `suaPosicao`.
- [ ] Um lance aceito chega ao room `lote:{id}` e ao room `vitrine`; `voce_foi_superado` e `saldo_atualizado` só chegam ao `usuario:{id}` certo; anônimo não recebe evento privado.
- [ ] Com `transports: ['polling']` a conexão é recusada.
- [ ] A 51ª entrada em um lote responde `SALA_CHEIA` e a 201ª conexão é recusada com `SERVIDOR_CHEIO`.
- [ ] Limites por socket: o `entrar_lote` do 11º lote distinto responde `DADOS_INVALIDOS`; o 6º `entrar_lote` no mesmo segundo responde `INDISPONIVEL`; o 21º evento do cliente no mesmo segundo é descartado.
- [ ] Teste de unidade do estado da sala: `lance_aceito` repetido (`seq` menor ou igual ao último) não muda o estado nem gera anúncio; `lance_aceito` com salto de `seq` não é aplicado e dispara exatamente um `entrar_lote`.
- [ ] Rollback do lance não publica nenhum evento.
- [ ] Nenhum payload público (evento ou estado) contém nome, e-mail ou id de usuário.

## Fora de escopo
Lance pelo socket; chat; presença ("quem está na sala").

## Decisões relacionadas
- decisions/0004-tempo-real-socketio-e-lance-rest.md, 0010-redis.md, 0025-cancelamento-em-liquidacao-e-arestas-dos-modulos.md, 0031-complementos-da-f3.md
