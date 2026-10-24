# 0004 — Tempo real com Socket.IO e lance via REST

Status: aceita
Data: 2026-10-24

## Contexto
A sala precisa atualizar sem recarregar, em < 1 s; o lance precisa de semântica de erro clara e ser testável sob carga.

## Decisão
Lance por `POST` REST com `Idempotency-Key` e erros tipados (no OpenAPI). Broadcast por Socket.IO 4.8 em rooms por lote e por usuário, só transporte websocket, com `@socket.io/redis-adapter` e resync de estado ao reconectar.

## Alternativas consideradas
- SSE + REST: limite de 6 conexões por domínio em HTTP/1.1; fan-out manual entre instâncias.
- Lance pelo WebSocket: perde a semântica HTTP, o contrato OpenAPI e a facilidade de teste.

## Consequências
Contrato de eventos em AsyncAPI 3 (`eventbus/socketio/asyncapi.yaml`); eventos publicados só após o COMMIT.
