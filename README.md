# Casa de Leilões

Casa de Leilões online de cartas **Magic: The Gathering** (dados e imagens da [Scryfall](https://scryfall.com)), feita como teste técnico Elite Dev da Verzel. Leiloeiros publicam lotes, licitantes disputam cada lote com lances ao vivo usando saldo simulado, e qualquer pessoa, sem login, audita o histórico de lances de um lote e confere que ele não foi adulterado.

- **Deploy público:** <https://teste-verzel.duckdns.org>
- **Repositório público:** <https://github.com/ElielDelfino/project-leilao-verzel>
- **Especificações (fonte da verdade):** [`specs/`](specs/INDEX.md). Decisões de arquitetura: [`specs/decisions/`](specs/decisions/HISTORY.md).
- **Licença:** MIT ([LICENSE](LICENSE)). Histórico de mudanças: [CHANGELOG.md](CHANGELOG.md).

## Índice

1. [Avisos](#avisos)
2. [Contas de demonstração e roteiro](#contas-de-demonstração-e-roteiro)
3. [Setup local](#setup-local)
4. [Arquitetura em uma tela](#arquitetura-em-uma-tela)
5. [Técnica antiadulteração](#técnica-antiadulteração)
6. [Comportamentos inesperados e decisões de regra](#comportamentos-inesperados-e-decisões-de-regra)
7. [Testes e carga](#testes-e-carga)
8. [Deploy e operação](#deploy-e-operação)
9. [Uso de IA](#uso-de-ia)
10. [Créditos](#créditos)

## Avisos

- **O k6 roda de fora da VPS.** O teste de carga nunca é executado no servidor de produção: ele roda na minha máquina ou num runner do CI, apontando para o endereço público (specs/013 §Níveis de teste, [specs/014](specs/014-deploy-e-operacao.md) §Produção, [ADR 0033](specs/decisions/0033-producao-em-vps-hostinger.md)).
- **`pnpm demo:adulterar` nunca roda em produção.** O script altera um lance direto no banco, desligando o trigger que protege a tabela, só para mostrar que a auditoria acusa "adulterado". A VPS não tem Node nem o repositório, o script recusa `NODE_ENV=production` e exige o opt-in explícito `DEMO_ADULTERAR=1` ([specs/008](specs/008-integridade-do-historico.md) §Interfaces, [specs/014](specs/014-deploy-e-operacao.md) §Produção). Use só contra o banco de desenvolvimento.
- A senha das contas de demonstração é pública de propósito (abaixo). Não existe senha de produção neste documento nem no repositório: os seis segredos reais vivem só na VPS ([docs/deploy.md](docs/deploy.md) §Segredos em produção).

## Contas de demonstração e roteiro

O `pnpm db:seed` (local) e o one-shot `seed` do compose de produção criam três contas com a mesma senha, `leilao-demo-2026`. Essa senha **não é segredo**: está no `.env` versionado, vale em dev, CI e produção, e é publicada aqui por decisão registrada ([specs/003](specs/003-identidade-e-auth.md) RF-03, [specs/014](specs/014-deploy-e-operacao.md) §Segredos).

| Papel | E-mail | Senha |
|---|---|---|
| Leiloeiro | `leiloeiro@demo.local` | `leilao-demo-2026` |
| Licitante | `ana@demo.local` | `leilao-demo-2026` |
| Licitante | `bruno@demo.local` | `leilao-demo-2026` |

**O seed cria só as três contas** ([`identidade/seed.ts`](apps/api/src/modules/identidade/seed.ts)); não há seed de depósito, de lote nem de lance. Em produção já existe um lote aberto, criado à mão pelo painel do leiloeiro com as contas acima; os licitantes depositam e dão lances pela interface. Localmente não há lote pronto: o roteiro abaixo cria o lote pelo painel ([specs/000](specs/000-visao-geral.md) RF-13), ou o atalho `pnpm demo:lote` (só local) cria um lote já com lances.

Há cadastro público em `/cadastro` (nome, e-mail, senha de 10 a 128 caracteres e papel, que não muda depois). Não há recuperação de senha nem exclusão de conta ([specs/000](specs/000-visao-geral.md) §Fora de escopo).

### Roteiro curto (RFs de [specs/000](specs/000-visao-geral.md))

Use dois navegadores (ou um normal e um anônimo) para ver o tempo real.

**Atalho para testar a auditoria (só local).** Com `pnpm dev` rodando e o seed aplicado, `pnpm demo:lote` entra com as três contas pela API, deposita saldo para Ana e Bruno, cria um lote de 5 minutos e dá 8 lances alternados. No fim imprime o link da sala, o link da auditoria e o comando pronto do `demo:adulterar` para esse lote. Pode ser rodado de novo (cada execução cria um lote novo). Precisa de internet, porque a carta vem da Scryfall. O lote nasce **ao vivo**: o selo e o comprovante só aparecem 5 minutos depois, quando ele encerra. O script recusa qualquer URL que não seja `localhost` e `NODE_ENV=production`; em produção o lote é criado à mão pelo painel.

1. **Vitrine (RF-01, RF-08).** Sem login, em `/`: abas Ao vivo, Agendados e Encerrados; busca por título ou carta, raridade, faixa de preço e ordenação. Lotes cancelados nunca aparecem.
2. **Criar um lote (RF-02).** Entre como `leiloeiro@demo.local`, vá a "Painel" → "Novo lote", busque uma carta na Scryfall, escolha-a e crie o lote com "Começar agora" e fim a pelo menos 5 minutos (use 6 a 10 minutos para ver o anti-sniping).
3. **Carteira (RF-04).** Em outro navegador, entre como `ana@demo.local`, abra "Carteira" e faça um depósito simulado (R$ 1,00 a R$ 100.000,00). Total, comprometido e disponível aparecem na tela.
4. **Lance ao vivo (RF-03).** Ana abre a sala do lote (`/lotes/:id`) e dá um lance: a sala mostra lance atual, histórico, contagem regressiva e "Você está ganhando".
5. **Superado em menos de 1 s (RF-03, RNF-03).** Entre como `bruno@demo.local` (depósito antes) e cubra o lance. Ana vê "Você foi superado" sem recarregar, e o valor dela volta ao disponível.
6. **Recusas claras (RF-07).** Tente: valor abaixo do mínimo, mais do que o saldo disponível, cobrir o próprio lance (líder), lance em lote agendado ou encerrado, e dar lance como leiloeiro. Cada caso mostra a mensagem própria (lista em [specs/012](specs/012-frontend-telas.md) §Comportamento).
7. **Anti-sniping.** Um lance feito a menos de 2 minutos do fim leva o fim para "agora + 2 minutos"; a sala mostra o selo "Fim estendido".
8. **Auditoria (RF-06).** Em `/auditoria/:loteId` (link "Ver auditoria" na sala): lista de lances pseudonimizados, selo e veredito "íntegro". O botão "Verificar no meu navegador" refaz hashes e assinaturas localmente.
9. **Encerramento, arremate e comprovante (RF-05).** Ao fim do lote, em até 2 s o vencedor é debitado, o leiloeiro creditado e o comprovante é emitido. Em "Meus arremates" aparecem "Meus lances" e "Arrematados", com o link do comprovante, que se copia e se abre sem login. O painel do leiloeiro mostra o resultado de cada lote e o total recebido.
10. **Cancelamento com estorno (RF-09).** No painel, "Cancelar lote" num lote com líder devolve o valor comprometido ao líder.
11. **Dark mode (RF-12).** Segue o tema do sistema; a alternância fica salva no navegador.
12. **Ver "adulterado" (local).** Veja [Técnica antiadulteração](#ver-o-veredito-adulterado-só-em-desenvolvimento).

## Setup local

### Pré-requisitos

| Ferramenta | Versão |
|---|---|
| Node | 24 LTS, **24.7 ou mais** (`.nvmrc`; a API usa `crypto.argon2`) |
| pnpm | 12 (fixado em `packageManager`) |
| Docker Engine + Docker Compose | Compose recente (testado com Docker 29.8 e Compose 5.5) |

### Passo a passo

```sh
pnpm install          # dependências e git hooks
pnpm keys:generate    # cria .env.local e .secrets/ com os segredos de desenvolvimento (fora do Git)
pnpm infra:up         # sobe Postgres e Redis (docker compose)
pnpm db:migrate       # aplica as migrations e a senha do papel leilao_api
pnpm db:seed          # cria as contas de demonstração (idempotente)
pnpm dev              # API e web em modo desenvolvimento
```

| Serviço | Endereço |
|---|---|
| Web (SPA) | <http://localhost:15173> |
| API | <http://localhost:13000> (`/api/health/ready`) |
| Postgres | `127.0.0.1:15432` |
| Redis | `127.0.0.1:16379` |

Se o `pnpm db:migrate` ou o `pnpm db:seed` falhar com `SQLSTATE 28P01` (senha recusada), já existe um banco de outro clone deste projeto neste computador: o compose usa sempre o projeto `leilao` e o volume `leilao_pgdata`, e a senha só é gravada quando o volume nasce. Veja [docs/dev-setup.md](docs/dev-setup.md) (§Senha dessincronizada). Num computador que nunca rodou o projeto isso não acontece.

Depois de um `git pull` que traga migrations ou segredos novos, rode de novo `pnpm keys:generate` (só acrescenta o que falta) e `pnpm db:migrate`. Problemas comuns (senha dessincronizada, portas ocupadas): [docs/dev-setup.md](docs/dev-setup.md). Variáveis e segredos: [docs/variaveis-de-ambiente.md](docs/variaveis-de-ambiente.md).

### Comandos do dia a dia

| Comando | O que faz |
|---|---|
| `pnpm verify:quick` | formato, lint, typecheck e testes só do que mudou desde a `main` (padrão) |
| `pnpm verify:full` | tudo, com banco isolado por Testcontainers; `pnpm verify:full --e2e` inclui o Playwright |
| `pnpm lint` · `pnpm format` · `pnpm typecheck` | lint, formatação e checagem de tipos |
| `pnpm contracts:gen` · `pnpm contracts:check` · `pnpm contracts:lint` | gera, confere e valida os tipos dos contratos OpenAPI e AsyncAPI |
| `pnpm db:generate` | gera migration a partir do schema (uso em desenvolvimento) |
| `pnpm db:sync-password` | reaplica a senha do dono do banco de dev sem apagar o volume |
| `pnpm demo:lote` | cria um lote ao vivo com 8 lances pela API local, para testar a auditoria (**só dev**) |
| `pnpm demo:adulterar` | demonstração de adulteração (**só dev**, ver [Avisos](#avisos)) |

Para o e2e, instale o Chromium do Playwright uma vez: `pnpm exec playwright install chromium`.

## Arquitetura em uma tela

```
 navegador (SPA React) ── REST /api ──►  API NestJS (monolito modular) ──► Postgres 18
        ▲                                      │  ▲                        (dados, imagens)
        └──── Socket.IO /leilao ◄──────────────┘  └──► Redis 8 (adapter Socket.IO, rate limit, cache)
                                                └──► Scryfall (só busca e snapshot na criação do lote)
```

Em produção, o Caddy termina o TLS, serve a SPA e faz proxy de `/api` e `/socket.io` para a API. Detalhes em [specs/001](specs/001-arquitetura.md).

**Monólito modular** ([ADR 0003](specs/decisions/0003-monolito-modular.md)): aceitar um lance mexe em lote, carteira e histórico na mesma transação, então tudo roda num processo só. Cada módulo vive em `apps/api/src/modules/<nome>/`, expõe só o `index.ts`, e nenhum módulo lê a tabela de outro (regra de lint com `eslint-plugin-boundaries`).

| Módulo | Dono de | Spec |
|---|---|---|
| `identidade` | `users`, `refresh_tokens` | [003](specs/003-identidade-e-auth.md) |
| `carteira` | `ledger_entries`, `wallet_balances` | [004](specs/004-carteira-ledger.md) |
| `catalogo` | `card_snapshots`, cache `scryfall:*` | [005](specs/005-catalogo-scryfall.md) |
| `lotes` | `lots` | [006](specs/006-lotes.md) |
| `lances` | `bids`, `lot_seals`, `signing_keys` | [007](specs/007-lances-e-regras.md), [008](specs/008-integridade-do-historico.md) |
| `tempo-real` | salas Socket.IO (sem tabelas) | [009](specs/009-tempo-real.md) |
| `liquidacao` | `receipts` | [010](specs/010-encerramento-e-liquidacao.md), [011](specs/011-auditoria-e-comprovante.md) |

- **Postgres 18:** dados, imagens das cartas (`bytea`) e as defesas de integridade. A API conecta como `leilao_api`, sem superusuário e sem poder dar `UPDATE`/`DELETE` nas tabelas append-only ([database/postgres](database/postgres/README.md), [specs/014](specs/014-deploy-e-operacao.md) §Papéis do Postgres).
- **Redis 8:** adapter do Socket.IO, rate limit e cache da Scryfall; nada de dinheiro ou lance mora nele ([cache/redis](cache/redis/README.md)).
- **Socket.IO 4.8** (só websocket) para o tempo real; o **lance é REST** ([ADR 0004](specs/decisions/0004-tempo-real-socketio-e-lance-rest.md)).
- **SPA** React 19, Vite, TanStack Query e Tailwind, em pt-BR, com dark mode e foco em WCAG 2.2 AA ([specs/012](specs/012-frontend-telas.md)).
- **Contratos:** REST em [`apps/api/openapi.yaml`](apps/api/openapi.yaml) e eventos em [`eventbus/socketio/asyncapi.yaml`](eventbus/socketio/asyncapi.yaml); os tipos de `@leilao/contracts` são gerados deles.
- Dinheiro sempre em **centavos inteiros** (BRL), nunca float.

## Técnica antiadulteração

Objetivo ([specs/008](specs/008-integridade-do-historico.md), [ADR 0005](specs/decisions/0005-integridade-hash-chain-ed25519.md)): qualquer alteração, remoção ou inserção posterior no histórico de lances, mesmo feita direto no banco, é detectada pela auditoria.

1. **Hash chain por lote.** Cada lance tem `hash = SHA-256(forma canônica do lance)`. A forma canônica é um JSON com as chaves em ordem alfabética (`criadoEm`, `hashAnterior`, `loteId`, `pseudonimo`, `seq`, `valorCentavos`), igual à JCS (RFC 8785). O `hashAnterior` do lance 1 é `SHA-256("leilao-verzel:genesis:" + loteId)`; dos seguintes, o hash do lance anterior. Mexer num lance quebra todos os elos seguintes.
2. **Assinatura Ed25519 por lance.** A API assina o hash (os 32 bytes) com uma chave privada que existe **só no ambiente da API** (nunca no banco, no Git ou em log). Quem altera o banco e recalcula a cadeia não consegue refazer as assinaturas.
3. **Selo do lote.** Ao encerrar ou cancelar, a API grava e assina um selo com `totalLances`, `hashFinal`, vencedor (pseudônimo) e valor. Ele detecta o truncamento do fim da cadeia e vai no comprovante.
4. **Chaves públicas publicadas e rotação.** Toda chave pública que já assinou fica em `signing_keys` e é servida em `GET /api/auditoria/chaves`; trocar a chave privada mantém verificáveis os lances antigos ([ADR 0031](specs/decisions/0031-complementos-da-f3.md)).
5. **Defesas extras no banco.** Triggers recusam `UPDATE`/`DELETE` em `bids`, `lot_seals` e `signing_keys`, e o papel da API só tem `SELECT` e `INSERT` nelas.
6. **Verificação em dois lugares.** A auditoria (`GET /api/auditoria/lotes/{id}`, pública, sem cache) recalcula cinco coisas e reporta cada problema com o `seq`: sequência contígua, `hashAnterior`, `hash`, assinatura e conferência com o selo. O navegador repete a verificação (WebCrypto SHA-256 + `@noble/ed25519`) e a tela **mostra** qualquer discordância com o servidor. Veredito: "íntegro" ou "adulterado".
7. **Comprovante como âncora externa.** O comprovante do vencedor (`/comprovantes/:codigo`, link público e sem dados pessoais) carrega `hashFinal`, `keyId` e a assinatura do selo. Quem o guarda consegue provar depois que uma cadeia reassinada é outra.

### Fingerprint da chave pública

O `keyId` é o fingerprint da chave pública: os 16 primeiros caracteres hexadecimais de SHA-256 dos 32 bytes dela ([specs/008](specs/008-integridade-do-historico.md) §Chaves). A tela de auditoria mostra o `keyId` da chave usada na verificação. Como a verificação no navegador usa a chave que o próprio servidor publica, o fingerprint é divulgado **fora do servidor** (aqui e na página da release) para o visitante comparar ([specs/012](specs/012-frontend-telas.md) §Auditoria).

Chave de assinatura de produção, lida em `GET https://teste-verzel.duckdns.org/api/auditoria/chaves`:

| Campo | Valor |
|---|---|
| `keyId` | `5b8dd12eeb384542` |
| Algoritmo | Ed25519 |
| Chave pública (base64url) | `o2XWRyL30VwatKpvZPDqAqNw-SO6LCV25EBLAjNCthY` |
| Ativa desde | 2026-10-26T03:32:23.491Z |

### Limitações conhecidas

Honestidade sobre o que a técnica **não** garante ([specs/008](specs/008-integridade-do-historico.md) §Limitações conhecidas):

- **Truncar o fim antes do selo.** Num lote ao vivo (ainda sem selo), quem tem acesso ao banco pode apagar os **últimos** lances e ajustar a linha do lote: a cadeia que sobra continua contígua, encadeada e assinada, e a verificação não detecta. Sinal barato (não é prova): o `totalLances` de um `lance_aceito` recebido ao vivo maior que o número de lances da auditoria indica que lances sumiram. A âncora externa (OpenTimestamps) ficou fora do escopo.
- **Chave privada mais acesso ao banco** permitem forjar o histórico; por isso a chave fica separada do banco.
- **Dono do banco.** Quem escreve no banco acima do papel da API (superusuário ou dono) pode registrar uma chave própria em `signing_keys` e reassinar uma cadeia forjada. Contra esse atacante, a âncora é o comprovante do vencedor.
- **A verificação no navegador prova consistência interna**, não que a chave seja a verdadeira: quem controla o servidor controla também a chave publicada. Daí o fingerprint divulgado fora do servidor.
- **Teto de 1000 lances na auditoria pública.** Acima disso a rota responde 503 em vez de devolver uma cadeia truncada (um veredito parcial seria falso). Os lances continuam aceitos, assinados e encadeados, e o selo e o comprovante seguem válidos.

### Ver o veredito "adulterado" (só em desenvolvimento)

Com o ambiente local no ar e um lote com lances (o `<id>` do lote está na URL `/lotes/<id>`):

```sh
DEMO_ADULTERAR=1 pnpm demo:adulterar --lote <id> --seq <n>
```

O script soma 1 centavo ao valor do lance `<n>` direto no banco, sem refazer hash nem assinatura, e imprime o comando de restauração. Abra `/auditoria/<id>`: o servidor e o botão "Verificar no meu navegador" mostram "adulterado" com "lance #n: hash não confere". Para desfazer: `DEMO_ADULTERAR=1 pnpm demo:adulterar --lote <id> --seq <n> --restaurar --valor <centavos originais>`. Sem `DEMO_ADULTERAR=1` ele não faz nada; também recusa `NODE_ENV=production` e qualquer host de banco fora de `127.0.0.1`, `::1` e `localhost`. **Nunca em produção.**

## Comportamentos inesperados e decisões de regra

O que pode surpreender, e onde está decidido.

### Lances

- **Lances simultâneos.** Aceitar um lance é **uma única transação** que trava a linha do lote com `FOR UPDATE`: a verificação, a gravação do lance (com `seq` contíguo), a carteira e o novo líder acontecem juntos ou nada acontece. Em disputa de lock acima de 5 s, a resposta é 503, nunca 500. Os locks seguem a ordem lote → carteiras por `user_id` crescente, para dois lotes cruzados não darem deadlock ([specs/007](specs/007-lances-e-regras.md) §Transação, [specs/004](specs/004-carteira-ledger.md) §Comportamento, [ADR 0031](specs/decisions/0031-complementos-da-f3.md)).
- **Quem manda no relógio é o servidor.** "Agora" é o relógio do Postgres, lido uma vez dentro da transação; o relógio do cliente só corrige a contagem regressiva exibida ([specs/007](specs/007-lances-e-regras.md) §Relógio).
- **Anti-sniping.** Lance aceito a **menos de 2 minutos** do fim leva o fim para **agora + 2 minutos** (não "fim + 2 minutos"). Faltando exatamente 2 minutos, ou mais, o fim não muda. O fim só avança, nunca recua ([specs/007](specs/007-lances-e-regras.md) RF-05, [ADR 0001](specs/decisions/0001-decisoes-iniciais.md), [ADR 0031](specs/decisions/0031-complementos-da-f3.md)).
- **Recusas** (RF-07, ordem de verificação em [specs/007](specs/007-lances-e-regras.md)): lote encerrado ou cancelado, lote não iniciado, você já está ganhando (o líder não cobre o próprio lance), abaixo do mínimo (primeiro lance ≥ lance inicial; os seguintes ≥ lance atual + incremento), saldo insuficiente e leiloeiro não pode lançar. Cada uma tem código estável e mensagem em pt-BR ([specs/012](specs/012-frontend-telas.md) §Comportamento).
- **Repetição segura.** O lance leva uma `Idempotency-Key` (UUID): repetir a mesma tentativa devolve o lance original (200), sem lance nem lançamento novos; a mesma chave com outro valor ou lote é 422. O depósito tem a mesma regra ([specs/007](specs/007-lances-e-regras.md) §Idempotência, [specs/004](specs/004-carteira-ledger.md)).
- **Lance não é otimista.** O botão fica em "Enviando…" e a tela mostra o resultado do servidor.

### Carteira

- **Saldo comprometido.** Disponível = total − comprometido. O valor do **líder** fica comprometido; quando ele é superado, volta ao disponível na mesma transação do novo lance. O lance só é aceito se couber no disponível ([specs/004](specs/004-carteira-ledger.md)).
- **Ledger append-only.** Cada centavo é rastreável por lançamentos que nunca se alteram, e a projeção `wallet_balances` sempre bate com a soma do ledger (teste de reconciliação). O saldo nasce no primeiro lançamento: usuário sem lançamentos vê R$ 0,00.
- Só o licitante deposita (simulado). O leiloeiro vê o total recebido dos arremates.

### Encerramento, liquidação e cancelamento

- **Encerramento por varredura.** Um job de 1 s inicia lotes agendados e encerra os vencidos, com `FOR UPDATE SKIP LOCKED` (seguro com várias instâncias). Meta: lote liquidado em até 2 s depois do fim (p95). Lote sem lances fecha sem vencedor, sem lançamento e sem comprovante ([specs/010](specs/010-encerramento-e-liquidacao.md), [ADR 0008](specs/decisions/0008-encerramento-por-varredura.md), [ADR 0032](specs/decisions/0032-complementos-da-f4.md)).
- **Entre o fim e o job.** Um lance depois de `fim_em` é recusado (`LOTE_ENCERRADO`) mesmo que o job ainda não tenha rodado, porque a regra usa os horários. A vitrine deriva o status dos horários pelo mesmo motivo.
- **Liquidação em uma transação:** selo → débito do vencedor → crédito do leiloeiro → comprovante → status. Perdedores não têm lançamento extra: já foram liberados ao serem superados.
- **Cancelamento com estorno** (RF-09). Só o dono, enquanto o lote está agendado ou ao vivo. Com líder, estorna o valor comprometido dele e sela o histórico com status `cancelado`, tudo numa transação. **Depois de `fim_em` o cancelamento é recusado (409)**, mesmo que o job ainda não tenha encerrado: o lote vencido é liquidado, não cancelado. O lote cancelado some da vitrine, mas continua no painel do dono e tem auditoria ([specs/010](specs/010-encerramento-e-liquidacao.md) §Cancelamento, [ADR 0025](specs/decisions/0025-cancelamento-em-liquidacao-e-arestas-dos-modulos.md), [ADR 0035](specs/decisions/0035-ordem-do-cancelamento.md)).

### Scryfall fora do ar

- **Só a busca do painel depende da Scryfall.** Vitrine, sala, auditoria e comprovante funcionam 100% sem ela: a imagem e os dados da carta são gravados (snapshot, com a imagem em `bytea`) na criação do lote ([specs/005](specs/005-catalogo-scryfall.md) RNF-01, RNF-04 de [specs/000](specs/000-visao-geral.md)).
- A API respeita os limites da Scryfall: no máximo 2 req/s em busca e 10 req/s nas demais (token bucket global no Redis, sem rajada), cache de 24 h, e um circuito que abre por 30 s depois de um 429 ou de 5 falhas seguidas. Aberto, a busca sem cache responde 503 `CATALOGO_INDISPONIVEL` e a tela mostra em quantos segundos tentar de novo.
- Criar o lote é tudo ou nada: se o snapshot falha, nada é criado.

### Limites de uso (rate limit)

| Rota | Limite | Resposta |
|---|---|---|
| Login | 5 por minuto por IP + e-mail | 429 `MUITAS_TENTATIVAS` com `Retry-After` |
| Cadastro | 5 por minuto por IP | idem |
| Lance | 10 por segundo por usuário | idem, `Retry-After: 1` |
| Auditoria e comprovante (públicos) | teto global de 600 por minuto por contador. **Ainda não há limite por IP** (60 por minuto está planejado para quando o `trustProxy` entrar, tarefa 140) | idem; falha **aberta** se o Redis cair, para a prova de integridade não sumir |

Login, cadastro e lance falham **fechados** se o Redis cair (500). Detalhes e riscos aceitos em [specs/003](specs/003-identidade-e-auth.md) §Rate limit e [specs/011](specs/011-auditoria-e-comprovante.md) §Rate limit.

### Privacidade e pseudônimos

- Telas e respostas públicas (vitrine, sala, auditoria, comprovante) nunca trazem nome ou e-mail de licitante, nem id de usuário. Cada licitante aparece como `Licitante #xxxxxx`, calculado por HMAC-SHA256 de `loteId:userId` com a chave `PSEUDONYM_HMAC_KEY`. O pseudônimo é estável **dentro** do lote e **diferente entre lotes**, então não dá para ligar um licitante entre lotes ([specs/008](specs/008-integridade-do-historico.md)).
- **Rotação de `PSEUDONYM_HMAC_KEY`:** não rotacionar com lote aberto (agendado ou ao vivo). Os pseudônimos já gravados seguem válidos, mas o `seuPseudonimo` calculado com a chave nova deixaria de bater com o do líder na sala, e a indicação "você está ganhando" quebraria. A regra é operacional; a API não a impede ([ADR 0031](specs/decisions/0031-complementos-da-f3.md)).
- Dados coletados: nome, e-mail e senha (hash argon2id). Não há exclusão de conta (decisão provisória, [ADR 0001](specs/decisions/0001-decisoes-iniciais.md)). Retenção: lances, ledger e comprovantes são permanentes; logs, 14 dias.

### Outros

- **Enumeração de e-mail.** O cadastro com e-mail já usado responde 409, o que revela que a conta existe. Risco aceito: os dados são de demonstração e o login não vaza essa informação ([specs/003](specs/003-identidade-e-auth.md)).
- **Tempo real só por websocket**, com limite de 50 conexões por lote e 200 no total; se um evento se perde, a sala se ressincroniza sozinha (a cada 30 s sem eventos, na reconexão e quando há salto de `seq`) ([specs/009](specs/009-tempo-real.md)).
- **Papel imutável.** O papel (leiloeiro ou licitante) é escolhido no cadastro e não muda. Leiloeiro não dá lance, licitante não cria lote; não há administrador.
- **Sessão.** JWT de acesso de 15 min e refresh rotativo de 7 dias em cookies `httpOnly`, com CSRF por double-submit; o atributo `Secure` vale quando o site é servido por https ([specs/003](specs/003-identidade-e-auth.md), [ADR 0006](specs/decisions/0006-autenticacao-jwt-cookies.md)).

## Testes e carga

Níveis ([specs/013](specs/013-verificacao-e-testes.md), [ADR 0016](specs/decisions/0016-testes-dois-niveis.md)):

| Nível | Ferramenta | Escopo |
|---|---|---|
| Unidade | Vitest | regras de lance, anti-sniping, ledger, canonicalização, hash chain, verificação, pseudônimo, mensagens de erro no front |
| Integração | Vitest + Postgres e Redis reais | rotas da API, 50 lances concorrentes, job de encerramento, triggers, reconciliação do ledger |
| Contrato | Vitest + validador OpenAPI/AsyncAPI | toda resposta de teste de integração é validada contra o `openapi.yaml`; eventos contra o `asyncapi.yaml` |
| E2E | Playwright + axe-core | cadastro/login, depósito, lance → superado, liquidação → comprovante, adulteração detectada, cancelamento com estorno, acessibilidade |
| Carga | k6 | 50 VUs dando lances num lote + 200 sockets |

- Cobertura mínima de 80% (linhas e branches) nos módulos de domínio da API (`lances`, `carteira`, `lotes`, `liquidacao`, `identidade`).
- `pnpm verify:quick` é o padrão no desenvolvimento; `pnpm verify:full` (com `--e2e`) roda antes de PR e de release, e o CI sempre roda o full. Cada worktree usa o próprio banco de teste, para execuções paralelas não se apagarem ([specs/013](specs/013-verificacao-e-testes.md) §Banco de teste).
- O CI (GitHub Actions) roda `verify:full --e2e`, `pnpm audit`, gitleaks e CodeQL.

### Teste de carga (k6)

Metas ([specs/000](specs/000-visao-geral.md) RNF-01 a RNF-03, [ADR 0014](specs/decisions/0014-rnfs-de-demo.md)): 50 usuários simultâneos por lote e 200 no total; p95 do lance abaixo de 300 ms; lance aceito chega aos outros clientes em menos de 1 s. **O k6 roda de fora da VPS** (ver [Avisos](#avisos)) e nenhum lote do cenário passa de 1000 lances (teto da auditoria).

> **PENDENTE (tarefa 142 preenche):** resultados do k6, com comando de execução, p95 do `POST` do lance, tempo de entrega do evento, taxa de erro e de 429, data e alvo (local e VPS). Fonte: `load/RESULTADOS.md`.

## Deploy e operação

Produção numa VPS Hostinger (1 vCPU, 4 GB, Ubuntu 24.04, sem painel), com `https://teste-verzel.duckdns.org`, certificado Let's Encrypt emitido pelo Caddy, SSH só por chave e firewall liberando só 22, 80 e 443 ([ADR 0033](specs/decisions/0033-producao-em-vps-hostinger.md), [specs/014](specs/014-deploy-e-operacao.md)).

- Push na `main` com CI verde: as imagens são construídas no GitHub Actions (nunca na VPS), publicadas no GHCR e implantadas por SSH com comando forçado. Health check falho volta sozinho para a versão anterior ([docs/deploy.md](docs/deploy.md)).
- Os seis segredos (`DB_PASSWORD`, `DB_API_PASSWORD`, `REDIS_PASSWORD`, `JWT_SECRET`, `ED25519_PRIVATE_KEY`, `PSEUDONYM_HMAC_KEY`) existem só na VPS, em arquivo, e uma verificação do deploy confere que nenhum aparece nas saídas do Docker. Nenhum vai para o GitHub.
- Runbook da VPS (hardening, rotação, reinício, backup manual): [docs/operacao.md](docs/operacao.md).
- **Fora do escopo da entrega** ([ADR 0034](specs/decisions/0034-backup-e-uptime-fora-da-entrega.md)): backup agendado, cópia externa cifrada, teste de restauração e monitor de uptime. Fica um `pg_dump` manual antes da entrega.
- Custo: só o preço fixo da VPS; nenhum serviço cobrado por uso.

## Uso de IA

Construí este projeto com o **Claude Code**, da Anthropic. A IA escreveu a maior parte do código e das especificações; eu defini o escopo e as regras, tomei as decisões de arquitetura, revisei o que entrou e aprovei cada merge, push e deploy. O processo completo está em [specs/002](specs/002-organizacao-do-trabalho.md) e nas ADRs [0019](specs/decisions/0019-organizacao-agentes-e-git.md), [0021](specs/decisions/0021-orquestracao-e-agentes-executores.md), [0028](specs/decisions/0028-modelo-e-esforco-por-papel.md) e [0030](specs/decisions/0030-merge-local-por-lote.md).

**Como trabalhei**

- **Specs primeiro.** As especificações em `specs/` são a fonte da verdade: toda mudança de comportamento começa por elas, e cada decisão vira uma ADR. `scripts/agents/check_specs.py` confere a consistência de specs, ADRs, tarefas e links.
- **Tarefas pequenas, uma área por vez.** Dividi o trabalho em tarefas por área (API, web, banco, infra, testes e docs). Cada uma foi feita numa branch própria, por um agente do Claude Code restrito à pasta daquela área. Um hook (`scripts/agents/guard_paths.py`) bloqueia edições fora dela; ele não cobre escrita via shell, então a última barreira é a revisão do diff.
- **Revisão em camadas.** Todo código passa por revisores automatizados (qualidade; segurança em autenticação, carteira, lances, integridade e infra; SQL), e eu leio os relatórios e o diff. Achados graves voltam para correção antes do merge.
- **Verificação.** Cada mudança vem com o teste que a cobre. `pnpm verify:quick` roda no dia a dia, `pnpm verify:full` roda a cada lote na `main` local, e o CI (gitleaks, `audit`, CodeQL e o full) roda a cada PR.
- Commits no padrão Conventional Commits, citando o número da tarefa.

**O que eu decidi e aprovei**

- Escopo, prazo e a escolha de não ter plano de corte ([ADR 0001](specs/decisions/0001-decisoes-iniciais.md)); a API externa e a stack ([ADR 0002](specs/decisions/0002-api-externa-scryfall.md), [ADR 0011](specs/decisions/0011-stack-backend-frontend.md)); a técnica de integridade; as metas de carga ([ADR 0014](specs/decisions/0014-rnfs-de-demo.md)); a produção numa VPS e o que fica fora da entrega (ADRs 0033 e 0034).
- Cada merge, push e PR; as dependências de produção; as mudanças em contratos, dinheiro, lance ou integridade; e qualquer ação com custo (lista em [specs/002](specs/002-organizacao-do-trabalho.md)).
- Toda ação na VPS, no DuckDNS e nos secrets do GitHub: nenhum agente acessa a VPS ([docs/operacao.md](docs/operacao.md)).

**Limites assumidos:** como a IA escreveu a maior parte do código, a qualidade depende dos testes, das revisões automatizadas e da minha leitura dos relatórios e do diff. Nenhum segredo real é passado aos agentes.

## Créditos

Autor: Eliel Delfino ([@ElielDelfino](https://github.com/ElielDelfino)).

Dados e imagens das cartas: [Scryfall](https://scryfall.com). Este projeto não usa logos da Scryfall nem sugere endosso dela.

Casa de Leilões é um conteúdo de fã não oficial permitido sob a [política de conteúdo de fãs](https://company.wizards.com/pt-br/legal/fancontentpolicy). Não aprovado/apoiado pela Wizards. Porções do material usado são propriedade da Wizards of the Coast. ©Wizards of the Coast LLC.
