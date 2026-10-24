# 0005 — Integridade: hash chain + Ed25519 + selo

Status: aceita
Data: 2026-10-24

## Contexto
O PDF exige detectar qualquer alteração, remoção ou inserção posterior no histórico, **mesmo direto no banco**.

## Decisão
Hash chain SHA-256 por lote sobre JSON canônico (RFC 8785); cada lance assinado com Ed25519 cuja chave privada fica só no ambiente da API (Secret Manager); selo assinado no encerramento ou cancelamento (contagem + hash final), embutido no comprovante; verificação no servidor e no navegador; triggers append-only como defesa adicional. Detalhes em specs/008.

## Alternativas consideradas
- Só hash chain: quem tem acesso ao banco recalcula a cadeia; não atende ao requisito.
- Merkle + âncora externa (OpenTimestamps): mais forte contra truncamento antes do selo, mas cria dependência externa e consome prazo.

## Consequências
- Limitação documentada: antes do selo, o truncamento dos últimos lances junto com a edição do lote não é detectável sem âncora externa.
- A rotação de chave usa `key_id`; as chaves públicas antigas continuam publicadas.
