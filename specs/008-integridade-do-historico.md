# 008 — Integridade do histórico

Status: aprovada
Depende de: 001

## Contexto
Qualquer alteração, remoção ou inserção posterior no histórico, mesmo direto no banco, deve ser detectada pela auditoria. A técnica precisa ser explicada no README.

## Técnica (ADR 0005)
**Hash chain por lote + assinatura Ed25519 por lance + selo assinado no encerramento.**

- Forma canônica do lance: JSON canonicalizado (RFC 8785/JCS) de
  `{loteId, seq, pseudonimo, valorCentavos, criadoEm (ISO 8601 UTC, ms), hashAnterior (hex)}`.
- `hash = SHA-256(canônico)`. Gênese: `hashAnterior = SHA-256("leilao-verzel:genesis:" + loteId)`.
- `assinatura = Ed25519(chavePrivada, hash)`. A chave privada **existe só no ambiente da API** (Secret Manager), nunca no banco; `key_id` identifica a chave para permitir rotação.
- Selo (`lot_seals`) gerado quando o lote é encerrado ou cancelado: canônico de `{loteId, status, totalLances, hashFinal, vencedorPseudonimo, valorArremateCentavos, seladoEm}` assinado. O selo vai no comprovante.
- Pseudônimo: `"Licitante #" + hex(HMAC-SHA256(PSEUDONYM_HMAC_KEY, loteId + ":" + userId))[0..6]`. É estável dentro do lote e diferente entre lotes, então não dá para ligar um licitante entre lotes.
- Defesa adicional: triggers impedem UPDATE/DELETE em `bids` e `lot_seals` (um superusuário pode removê-los, e a detecção continua valendo).

## Verificação
A auditoria recalcula e reporta cada problema com o `seq`:
1. seq contígua de 1 a n (detecta remoção no meio e inserção fora de ordem);
2. cada `hashAnterior` = `hash` do lance anterior (detecta alteração e inserção);
3. cada `hash` = SHA-256(canônico) (detecta alteração de campo);
4. cada assinatura válida com a chave pública de `key_id` (detecta recálculo da cadeia por quem não tem a chave);
5. se selado: total e hash final iguais aos do selo, e assinatura do selo válida (detecta truncamento no fim).

Veredito: `integro` se tudo passar; senão `adulterado` + lista de problemas. A verificação roda no servidor **e no navegador** (WebCrypto SHA-256 + `@noble/ed25519`), com a chave pública em `GET /api/auditoria/chaves`.

## Limitações conhecidas (vão para o README)
- Antes do selo (lote ao vivo), alguém com acesso ao banco pode apagar os **últimos** lances e ajustar a linha do lote; sem âncora externa, isso não é detectável. Mitigação parcial: os clientes conectados viram os hashes ao vivo. Âncora externa (OpenTimestamps) ficou fora (ADR 0005).
- Quem tiver a chave privada E acesso ao banco pode forjar o histórico; por isso a chave fica separada do banco.

## Interfaces e contratos
- `GET /api/auditoria/lotes/{id}` (público): lote, lances (seq, pseudônimo, valor, criadoEm, hashAnterior, hash, assinatura, keyId), selo, veredito do servidor
- `GET /api/auditoria/chaves` (público): `[{keyId, algoritmo: "Ed25519", chavePublica (base64url), ativaDesde}]`
- Script de demonstração `pnpm demo:adulterar --lote <id> --seq <n>` (só dev/demo): altera um lance via SQL desabilitando o trigger, para mostrar a detecção.

## Dados
- Colunas de integridade em `bids` (specs/007).
- `lot_seals(lote_id pk, status, total_lances, hash_final, vencedor_pseudonimo, valor_arremate_centavos, selado_em, assinatura, key_id)`
- Retenção: permanente.

## Critérios de aceite
- [ ] Testes para cada adulteração: alterar valor, apagar o lance do meio, inserir lance, recalcular a cadeia sem a chave, truncar o fim de um lote selado. Todas detectadas.
- [ ] Verificação no navegador e no servidor dão o mesmo veredito.

## Decisões relacionadas
- decisions/0005-integridade-hash-chain-ed25519.md
