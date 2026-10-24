# 009 — Tempo real

Status: aprovada
Depende de: 001, 007

## Requisitos
- RF-01 A sala atualiza lance atual, histórico, posição, contagem regressiva e "ganhando/superado" sem recarregar.
- RF-02 A vitrine atualiza o lance atual e o status dos cards visíveis.
- RNF-01 Um lance aceito aparece nos outros clientes em < 1 s (p95).
- RNF-02 50 conexões por lote e 200 no total numa instância da e2-micro.

## Comportamento
- Socket.IO 4.8, namespace `/leilao`, **só transporte websocket** (sem long-polling, dispensando sticky session). Adapter Redis para escalar horizontalmente no futuro.
- Handshake autenticado pelo cookie `access_token` (specs/003); sem cookie = anônimo (só leitura).
- Rooms: `lote:{id}` (público) e `usuario:{id}` (privado, entrada automática quando autenticado).
- Cliente → servidor: `entrar_lote {loteId}` com ack `{estado}`, `sair_lote {loteId}`.
- `estado` = `{lote, ultimosLances (50), agoraServidor, seuPseudonimo?, suaPosicao?}`. O cliente usa `agoraServidor` para corrigir o relógio da contagem regressiva e compara `seuPseudonimo` com o líder para mostrar "ganhando/superado".
- Eventos só são publicados **depois do COMMIT**. Se o processo cair entre o COMMIT e a publicação, o cliente se recupera no resync.
- Reconexão: o cliente refaz `entrar_lote` e substitui o estado local (resync). Se nenhum evento chegar em 30 s numa sala ao vivo, o cliente faz um resync preventivo.

## Interfaces e contratos
`eventbus/socketio/asyncapi.yaml` (AsyncAPI 3). Servidor → cliente:

| evento | room | payload |
|---|---|---|
| `lance_aceito` | `lote:{id}` | `{loteId, seq, pseudonimo, valorCentavos, criadoEm, fimEm, totalLances}` |
| `fim_estendido` | `lote:{id}` | `{loteId, fimEm}` |
| `lote_iniciado` | `lote:{id}` | `{loteId}` |
| `lote_encerrado` | `lote:{id}` | `{loteId, vencedorPseudonimo?, valorArremateCentavos?}` |
| `lote_cancelado` | `lote:{id}` | `{loteId}` |
| `voce_foi_superado` | `usuario:{id}` | `{loteId, valorCentavos}` |
| `saldo_atualizado` | `usuario:{id}` | `{totalCentavos, comprometidoCentavos, disponivelCentavos}` |
| `lote_arrematado` | `usuario:{id}` | `{loteId, codigoComprovante}` |

## Dados
Nenhum dado persistido.

## Critérios de aceite
- [ ] Teste e2e com dois navegadores: B supera A e A vê "você foi superado" em < 1 s.
- [ ] Derrubar a conexão e voltar resulta em estado idêntico ao do servidor.

## Fora de escopo
Lance pelo socket; chat; presença ("quem está na sala").

## Decisões relacionadas
- decisions/0004-tempo-real-socketio-e-lance-rest.md, 0010-redis.md
