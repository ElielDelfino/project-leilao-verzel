# 011 — Auditoria pública e comprovante

Status: aprovada
Depende de: 008, 010

## Requisitos
- RF-01 Página pública, sem login, com o histórico completo de lances de um lote e o veredito "íntegro" ou "adulterado".
- RF-02 Comprovante de arremate com link compartilhável, sem dados pessoais.
- RF-03 "Meus arremates", com duas abas: "Meus lances" (lotes em que o licitante deu lance, com a posição `ganhando`, `superado`, `venceu` ou `perdeu`, calculada por `lances`, specs/007 §Posição do usuário no lote) e "Arrematados" (lotes vencidos, com o comprovante).
- RNF-01 Rate limit nas rotas públicas de leitura (§Rate limit): teto global de 600/min por contador até a tarefa 020 (`trustProxy`, F5) e 60/min por IP depois; falha aberta se o Redis cair.

## Comportamento
Os textos exatos das telas estão em specs/012 (§Auditoria, §Comprovante, §Meus arremates); aqui ficam o comportamento e os dados.
- **Auditoria** (`/auditoria/{loteId}`): cabeçalho do lote, tabela de lances pseudonimizados (a cadeia inteira, sem paginação, specs/008), selo, veredito do servidor e o botão "Verificar no meu navegador", que repete a verificação localmente (specs/008 §Verificação). Os dados vêm de `GET /api/auditoria/lotes/{id}` e `GET /api/auditoria/chaves`. Problemas mostram o `seq` e o tipo (ex.: "lance #4: hash não confere"), a partir do código do problema. Se o navegador e o servidor discordam (veredito ou lista de problemas diferentes), a tela mostra a discordância; nunca a esconde. A página não chama a Scryfall nem mostra imagem de carta.
- **Comprovante** (`/comprovantes/{codigo}`): imagem e nome da carta, valor, data, pseudônimo do vencedor, hash final, assinatura do selo, `keyId`, data do selo e link para a auditoria. Nunca mostra nome nem e-mail. Código inexistente e código fora do formato `^[0-9A-Za-z]{16}$` dão o mesmo 404, sem pista de qual foi.
- **Meus arremates** (`/meus-arremates`): aba "Meus lances" por `GET /api/me/lances` (specs/007) e aba "Arrematados" por `GET /api/me/arremates`, 24 por página nas duas.
- Na API, só o vencedor lista os próprios comprovantes (`vencedor_id` = usuário da sessão); o acesso público é exclusivamente pelo `codigo_publico` (anti-IDOR). A carta (nome e `imagemUrl`, sempre `/api/imagens/{snapshotId}`) vem do resumo do lote (`lotes.obterResumos`, em lote, sem uma consulta por recibo); a Scryfall nunca é chamada.

### Rate limit
`GET /api/auditoria/lotes/{id}`, `GET /api/auditoria/chaves` e `GET /api/comprovantes/{codigo}` têm rate limit, com o mesmo `LimiteDeTentativas` do login e do lance (specs/003 §Rate limit, specs/007; janela fixa de 60 s). Há **dois contadores**: um para as duas rotas de auditoria (uma visita à página consome 2) e outro para o comprovante. Acima do limite: 429 `MUITAS_TENTATIVAS` com `Retry-After` (segundos, o TTL restante da chave, mínimo 1) e `Cache-Control: no-store`. As rotas autenticadas (`/api/me/*`) não têm esse limite.

**Dois regimes, por causa do `trustProxy` (ADR 0027):**
- **Até a tarefa 020 (F5), teto global, sem limite fino por IP.** Sem `trustProxy` confiável, o `{ip}` é o do Caddy e todos os clientes dividem a mesma chave; um limite de 60/min por IP viraria um limite global de 60/min para o site inteiro, e um único cliente derrubaria a auditoria de todos. Por isso, enquanto não houver `trustProxy`, **nenhum limite fino por IP** vale nessas rotas: aplica-se só um **teto global de 600 requisições por minuto por contador**, chaves `ratelimit:auditoria:global` e `ratelimit:comprovante:global`. É um freio contra abuso grosseiro, não contra um cliente específico. **Risco aceito e registrado, como em specs/003 §Rate limit:** quem enviar 600 requisições por minuto esgota o teto para todos os visitantes até a virada da janela (429 para todos); a defesa contra isso é o limite por IP do regime seguinte.
- **A partir da tarefa 020 (`trustProxy` confiável, F5), 60 requisições por minuto por IP**, com as chaves `ratelimit:auditoria:{ip}` e `ratelimit:comprovante:{ip}`, e o teto global de 600 continua como segunda barreira. O `{ip}` de IPv6 é **agrupado por /64** (o prefixo de 64 bits, em hexadecimal, vira a chave; um cliente IPv6 controla um /64 inteiro e giraria o endereço para fugir do limite). IPv4 usa o endereço inteiro.

**Regras comuns aos dois regimes:**
- **O contador conta depois da validação de formato** (specs/003 §Ordem das verificações: validação na etapa 4, rate limit na 5): `id` que não é UUID e `codigo` fora de `^[0-9A-Za-z]{16}$` respondem 404 antes do contador e **não o consomem**. A requisição bem formada conta, mesmo que o recibo ou o lote não exista (404 depois do contador), e o 429 sai antes de qualquer consulta ao banco.
- **Janela fixa:** a virada da janela permite uma rajada de até **2 vezes** o limite (o limite inteiro no fim de uma janela e o limite inteiro no início da seguinte). Aceito: o limite é freio de abuso, não garantia de cota.
- **Redis fora: falha ABERTA** nessas rotas (e só nelas): a requisição passa sem contar, e a API registra um aviso de log (só o nome do contador, sem IP, no máximo um por minuto por instância). A prova de integridade pública não pode sumir por uma queda de infraestrutura; o custo é ficar sem o freio de abuso enquanto o Redis estiver fora. **Login, cadastro e lance continuam com falha fechada** (specs/003, specs/007). Quando o banco, e não o Redis, está fora, as três rotas respondem 503 `INDISPONIVEL`, sem `detalhes` (specs/001 §Erros); a SPA mostra a mensagem de `INDISPONIVEL` (specs/012).

## Interfaces e contratos
Contrato em `apps/api/openapi.yaml` 0.6.0. **Todas** as respostas abaixo, de sucesso **e de erro** (404, 429, 401, 403, 422, 503), são `Cache-Control: no-store`, exceto o 200 de `GET /api/auditoria/chaves` (`public, max-age=60`, specs/008); os erros declaram o header no contrato.
- `GET /api/auditoria/lotes/{id}`, `GET /api/auditoria/chaves` (specs/008) · 429 `MUITAS_TENTATIVAS` (§Rate limit: teto global de 600/min até a tarefa 020, 60/min por IP depois) · 503 `INDISPONIVEL`
- `GET /api/comprovantes/{codigo}` (público) → 200 `Comprovante` `{codigo, vencedorPseudonimo, valorCentavos, carta {nome, imagemUrl}, hashFinal (hex), assinaturaSelo (base64url), keyId, seladoEm, emitidoEm, auditoriaUrl}` · 404 · 429 · 503 `INDISPONIVEL`
- `GET /api/me/arremates?pagina=` (licitante) → 200 lista de `Arremate` `{codigo, valorCentavos, carta {nome, imagemUrl}, emitidoEm, auditoriaUrl}` + `meta {total, pagina, limite: 24}`, por `emitidoEm` decrescente · 401 · 403 `PAPEL_NAO_PERMITIDO` (leiloeiro) · 422 (`pagina` fora de 1 a 500; além da última, 200 com lista vazia) · 503 `INDISPONIVEL`
- `auditoriaUrl` é a rota da SPA, `/auditoria/{loteId}`; a rota do comprovante na SPA é `/comprovantes/{codigo}`. Nenhum dos dois schemas tem nome, e-mail nem id de usuário.
- `GET /api/me/lances` (specs/007; implementado por `lances`). `GET /api/me/arremates` e `GET /api/comprovantes/{codigo}` são de `liquidacao`, que obtém o lote por `lotes` (specs/001).

## Critérios de aceite
- [ ] Após `pnpm demo:adulterar`, a página mostra "adulterado" com o seq correto, no servidor e no navegador.
- [ ] Nenhuma resposta pública contém e-mail ou nome de licitante (teste que varre o JSON das rotas públicas, com um controle negativo que prova que a varredura enxerga o dado quando ele existe).
- [ ] Um licitante não lê o recibo de outro: `/api/me/arremates` só traz os recibos dele e um código errado dá 404 sem pista; código inexistente e malformado dão a mesma resposta.
- [ ] Servir o comprovante e `/api/me/arremates` não chama a Scryfall (teste com cliente falso que falha se chamado).
- [ ] Teto global (regime da F4): a 601ª requisição em um minuto às rotas de auditoria, e a 601ª ao comprovante, recebe 429 `MUITAS_TENTATIVAS` com `Retry-After` entre 1 e 60 e `Cache-Control: no-store`; as 60 primeiras requisições do mesmo IP não são limitadas por IP (teste de integração com o contador e o relógio controlados; chaves `ratelimit:auditoria:global` e `ratelimit:comprovante:global`).
- [ ] `id` não UUID em `/api/auditoria/lotes/{id}` e `codigo` malformado em `/api/comprovantes/{codigo}` → 404 sem consumir o contador (1000 requisições malformadas, a seguinte bem formada ainda passa); requisição bem formada para recurso inexistente consome o contador.
- [ ] Redis fora → as três rotas públicas respondem normalmente (falha aberta, com um aviso de log sem IP); login, cadastro e lance seguem em falha fechada (500 `INDISPONIVEL`, testes de specs/003 e 007 inalterados); banco fora → 503 `INDISPONIVEL` sem `detalhes` (teste de integração).
- [ ] 404 e 429 do comprovante e da auditoria, e 401, 403 e 422 de `/api/me/arremates`, saem com `Cache-Control: no-store` (teste de integração e `pnpm contracts:lint`).
- [ ] Tarefa 020 (F5, só depois de `trustProxy` confiável): a 61ª requisição de um IP em um minuto às rotas de auditoria, e a 61ª ao comprovante, recebe 429 com `Retry-After`; dois endereços do mesmo /64 IPv6 dividem o contador; o teto global de 600 continua valendo.
- [ ] `/api/me/arremates`: 24 por página, `emitidoEm` decrescente, leiloeiro → 403, anônimo → 401, `pagina` 0 e 501 → 422.
- [ ] Verificação no navegador e no servidor dão o mesmo veredito e a mesma lista de problemas; se discordarem, a tela avisa (specs/012).

## Decisões relacionadas
- decisions/0005-integridade-hash-chain-ed25519.md
