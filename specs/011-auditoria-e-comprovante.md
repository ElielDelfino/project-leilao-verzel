# 011 — Auditoria pública e comprovante

Status: aprovada
Depende de: 008, 010

## Requisitos
- RF-01 Página pública, sem login, com o histórico completo de lances de um lote e o veredito "íntegro" ou "adulterado".
- RF-02 Comprovante de arremate com link compartilhável, sem dados pessoais.
- RF-03 "Meus arremates": lotes em que o licitante deu lance (com a posição) e lotes vencidos (com o comprovante).

## Comportamento
- Auditoria (`/auditoria/{loteId}`): tabela de lances pseudonimizados, selo, veredito do servidor e botão "verificar no meu navegador", que repete a verificação localmente (specs/008). Problemas mostram o seq e o tipo (ex.: "lance #4: hash não confere").
- Comprovante (`/comprovantes/{codigo}`): imagem e nome da carta, valor, data, pseudônimo do vencedor, hash final, assinatura do selo e link para a auditoria. Nunca mostra nome nem e-mail.
- Na API, só o vencedor lista os próprios comprovantes; o acesso público é exclusivamente pelo `codigo_publico` (anti-IDOR).

## Interfaces e contratos
- `GET /api/auditoria/lotes/{id}`, `GET /api/auditoria/chaves` (specs/008)
- `GET /api/comprovantes/{codigo}` (público) · 404
- `GET /api/me/arremates` (licitante) → `[{lote, valorCentavos, codigoComprovante, emitidoEm}]`
- `GET /api/me/lances` (specs/007)

## Critérios de aceite
- [ ] Após `pnpm demo:adulterar`, a página mostra "adulterado" com o seq correto.
- [ ] Nenhuma resposta pública contém e-mail ou nome de licitante (teste que varre o JSON das rotas públicas).

## Decisões relacionadas
- decisions/0005-integridade-hash-chain-ed25519.md
