# Casa de Leilões

Casa de Leilões online de cartas **Magic: The Gathering** (dados e imagens da [Scryfall](https://scryfall.com)), feita como teste técnico Elite Dev da Verzel. Leiloeiros publicam lotes, licitantes disputam cada lote com lances ao vivo usando saldo simulado, e qualquer pessoa, sem login, audita o histórico de lances de um lote e confere que ele não foi adulterado.

- **Deploy público:** <https://teste-verzel.duckdns.org>
- **Repositório:** <https://github.com/ElielDelfino/project-leilao-verzel>
- **Especificações (fonte da verdade):** [`specs/`](specs/INDEX.md) · decisões em [`specs/decisions/`](specs/decisions/HISTORY.md)
- **Licença:** MIT ([LICENSE](LICENSE)) · [CHANGELOG.md](CHANGELOG.md)

## Avisos

- **`pnpm demo:adulterar` nunca roda em produção.** Ele altera um lance direto no banco para mostrar a auditoria acusando "adulterado". Recusa `NODE_ENV=production`, aceita só banco em loopback e exige `DEMO_ADULTERAR=1`; a VPS nem tem Node ou o repositório ([specs/008](specs/008-integridade-do-historico.md) §Interfaces).
- A senha das contas de demonstração é pública de propósito. Os seis segredos reais vivem só na VPS ([docs/deploy.md](docs/deploy.md) §Segredos em produção).

## Contas de demonstração e roteiro

| Papel | E-mail | Senha |
|---|---|---|
| Leiloeiro | `leiloeiro@demo.local` | `leilao-demo-2026` |
| Licitante | `helena@demo.local` | `leilao-demo-2026` |
| Licitante | `otavio@demo.local` | `leilao-demo-2026` |

A senha está no `.env` versionado e vale em dev, CI e produção ([specs/003](specs/003-identidade-e-auth.md) RF-03). O seed ([`identidade/seed.ts`](apps/api/src/modules/identidade/seed.ts)) cria só as três contas, sem depósito, lote ou lance. Em produção já existe um lote aberto, criado pelo painel. Localmente, crie o lote pelo roteiro ou use `pnpm demo:lote`, que entra com as três contas, deposita saldo, cria um lote ao vivo de 5 minutos com 8 lances alternados e imprime os links da sala, da auditoria e o comando do `demo:adulterar` (só local; precisa de internet para a Scryfall). Há cadastro público em `/cadastro`; não há recuperação de senha nem exclusão de conta.

**Roteiro** (RFs de [specs/000](specs/000-visao-geral.md)). Use dois navegadores, ou um normal e um anônimo, para ver o tempo real.

1. **Vitrine (RF-01, RF-08):** sem login, em `/`, abas Ao vivo, Agendados e Encerrados, com busca, raridade, faixa de preço e ordenação.
2. **Criar lote (RF-02):** como leiloeiro, "Painel" → "Novo lote", busque a carta na Scryfall e crie com "Começar agora" e fim de 6 a 10 minutos.
3. **Carteira (RF-04):** como `helena@demo.local`, deposite um valor simulado (R$ 1,00 a R$ 100.000,00) e veja total, comprometido e disponível.
4. **Lance ao vivo (RF-03):** na sala (`/lotes/:id`), Helena dá um lance e vê lance atual, histórico, contagem regressiva e "Você está ganhando".
5. **Superado em menos de 1 s (RNF-03):** `otavio@demo.local` deposita e cobre o lance; Helena vê "Você foi superado" sem recarregar e o valor volta ao disponível.
6. **Recusas (RF-07):** abaixo do mínimo, sem saldo, cobrir o próprio lance, lote agendado ou encerrado, lance como leiloeiro; cada uma tem mensagem própria.
7. **Anti-sniping:** lance a menos de 2 minutos do fim leva o fim para "agora + 2 minutos" e mostra "Fim estendido".
8. **Auditoria (RF-06):** em `/auditoria/:loteId`, lances pseudonimizados, selo e veredito; "Verificar no meu navegador" refaz hashes e assinaturas localmente.
9. **Liquidação (RF-05):** até 2 s após o fim, o vencedor é debitado, o leiloeiro creditado e o comprovante emitido, com link público em "Meus arremates".
10. **Cancelamento com estorno (RF-09):** "Cancelar lote" no painel devolve o valor comprometido ao líder.
11. **Dark mode (RF-12):** segue o sistema; a escolha fica salva no navegador.
12. **Ver "adulterado":** [só em desenvolvimento](#ver-o-veredito-adulterado-só-em-desenvolvimento).

## Setup local

Pré-requisitos: Node **24.7 ou mais** (`.nvmrc`; a API usa `crypto.argon2`), pnpm 12 (fixado em `packageManager`) e Docker com Compose.

```sh
pnpm install          # dependências e git hooks
pnpm keys:generate    # cria .env.local e .secrets/ com os segredos de dev (fora do Git)
pnpm infra:up         # Postgres e Redis
pnpm db:migrate       # migrations e senha do papel leilao_api
pnpm db:seed          # contas de demonstração (idempotente)
pnpm dev              # web em http://localhost:15173, API em http://localhost:13000
```

Postgres fica em `127.0.0.1:15432` e Redis em `127.0.0.1:16379`. Se `db:migrate` ou `db:seed` falhar com `SQLSTATE 28P01`, há um banco de outro clone deste projeto na máquina (o compose usa sempre o projeto `leilao`): veja [docs/dev-setup.md](docs/dev-setup.md) §Senha dessincronizada. Depois de um `git pull` com migrations ou segredos novos, rode de novo `pnpm keys:generate` e `pnpm db:migrate`. Variáveis: [docs/variaveis-de-ambiente.md](docs/variaveis-de-ambiente.md).

| Comando | O que faz |
|---|---|
| `pnpm verify:quick` | formato, lint, typecheck e testes do que mudou desde a `main` |
| `pnpm verify:full [--e2e]` | tudo, com o Playwright opcional (antes: `pnpm exec playwright install chromium`) |
| `pnpm contracts:gen` · `contracts:check` · `contracts:lint` | tipos e validação dos contratos OpenAPI e AsyncAPI |
| `pnpm db:generate` · `db:sync-password` | gera migration a partir do schema · reaplica a senha do banco de dev |
| `pnpm demo:lote` · `demo:adulterar` | lote com lances · demonstração de adulteração (**só dev**) |

## Arquitetura

```
 navegador (SPA React) ── REST /api ──►  API NestJS (monolito modular) ──► Postgres 18
        ▲                                      │  ▲                        (dados, imagens)
        └──── Socket.IO /leilao ◄──────────────┘  └──► Redis 8
                                                └──► Scryfall (só busca e snapshot na criação do lote)
```

**Monólito modular** ([ADR 0003](specs/decisions/0003-monolito-modular.md)): aceitar um lance mexe em lote, carteira e histórico na mesma transação, então tudo roda num processo. Cada módulo em `apps/api/src/modules/<nome>/` expõe só o `index.ts`, e nenhum lê a tabela de outro (regra de lint com `eslint-plugin-boundaries`). Em produção, o Caddy termina o TLS, serve a SPA e faz proxy para a API ([specs/001](specs/001-arquitetura.md)).

| Módulo | Dono de | Spec |
|---|---|---|
| `identidade` | `users`, `refresh_tokens` | [003](specs/003-identidade-e-auth.md) |
| `carteira` | `ledger_entries`, `wallet_balances` | [004](specs/004-carteira-ledger.md) |
| `catalogo` | `card_snapshots`, cache `scryfall:*` | [005](specs/005-catalogo-scryfall.md) |
| `lotes` | `lots` | [006](specs/006-lotes.md) |
| `lances` | `bids`, `lot_seals`, `signing_keys` | [007](specs/007-lances-e-regras.md), [008](specs/008-integridade-do-historico.md) |
| `tempo-real` | salas Socket.IO | [009](specs/009-tempo-real.md) |
| `liquidacao` | `receipts` | [010](specs/010-encerramento-e-liquidacao.md), [011](specs/011-auditoria-e-comprovante.md) |

- **Postgres 18** guarda dados, imagens (`bytea`) e as defesas de integridade. A API conecta como `leilao_api`, sem superusuário e sem `UPDATE`/`DELETE` nas tabelas append-only ([database/postgres](database/postgres/README.md)).
- **Redis 8**: adapter do Socket.IO, rate limit e cache da Scryfall; dinheiro e lance nunca moram nele ([cache/redis](cache/redis/README.md)).
- **Tempo real** por Socket.IO 4.8 (só websocket); o **lance é REST** ([ADR 0004](specs/decisions/0004-tempo-real-socketio-e-lance-rest.md)).
- **SPA** React 19, Vite, TanStack Query e Tailwind, em pt-BR, dark mode e WCAG 2.2 AA ([specs/012](specs/012-frontend-telas.md)).
- **Contratos** em [`openapi.yaml`](apps/api/openapi.yaml) e [`asyncapi.yaml`](eventbus/socketio/asyncapi.yaml); os tipos de `@leilao/contracts` são gerados deles.
- Dinheiro sempre em **centavos inteiros**, nunca float.

## Decisões de stack

Escolhi uma stack de produção porque o produto tem requisitos que a pedem: lance atômico, tempo real em menos de 1 s, histórico que não pode ser adulterado, HTTPS e custo fixo. Entendo que um serviço só está pronto quando pode ser testado, publicado e revertido com segurança, e por isso a infraestrutura faz parte do projeto, não é um acessório dele. Cada item abaixo tem uma razão registrada em ADR e um custo que eu assumo.

| Escolha | Requisito que ela atende | Custo ou limite que eu assumo |
|---|---|---|
| **NestJS sobre Fastify** | Módulos com fronteiras impostas pelo ESLint, para que um módulo nunca leia a tabela de outro ([ADR 0003](specs/decisions/0003-monolito-modular.md), [0011](specs/decisions/0011-stack-backend-frontend.md)) | Mais estrutura e cerimônia que um Express enxuto |
| **Postgres 18** | Aceitar um lance é uma transação com `FOR UPDATE` no lote; tabelas append-only protegidas por trigger | Um banco a operar, migrar e fazer backup |
| **UUIDv7** (`uuidv7()` nativo) | IDs gerados no banco e ordenados por tempo ([ADR 0001](specs/decisions/0001-decisoes-iniciais.md)) | O ID revela o instante de criação |
| **Socket.IO** (só websocket) | Lance aceito aparece nos outros clientes em menos de 1 s (RNF-03) | Conexão longa: exige processo sempre ligado |
| **Redis 8** | Rate limit, token bucket e cache de 24 h da Scryfall ([ADR 0010](specs/decisions/0010-redis.md)) | Sem persistência; dinheiro e lance nunca moram nele |
| **Docker Compose + Caddy com TLS** | HTTPS obrigatório (cookies `Secure`, `wss`) e mesma imagem em dev e produção ([ADR 0033](specs/decisions/0033-producao-em-vps-hostinger.md)) | Mais peças no servidor; só o Caddy publica portas |
| **CI/CD no GitHub Actions** | Imagem por SHA no GHCR, deploy por SSH restrito, health check e **rollback automático** se o `/ready` falhar | Pipeline a manter; o rollback só vale porque foi testado |
| **Vitest e Playwright** | Toda mudança vem com o teste que a cobre, e os fluxos críticos têm e2e ([specs/013](specs/013-verificacao-e-testes.md)) | Testes lentos pesam, por isso há `verify:quick` e `verify:full` |
| **Swagger UI** em `/api/docs` | Contrato navegável, lido do mesmo `openapi.yaml` que o CI valida ([ADR 0036](specs/decisions/0036-swagger-ui-em-api-docs.md)) | Dependência de terceiros na mesma origem dos cookies; mitigada com versão exata e CSP intacta |

### Por que Redis, tecnicamente
O Redis aqui guarda só **estado compartilhado e efêmero**; todo estado durável (dinheiro, lances, histórico) mora no Postgres. Ele entra em quatro pontos, e em cada um a técnica foi escolhida pelo que ela garante ([ADR 0010](specs/decisions/0010-redis.md), [cache/redis](cache/redis/README.md)):

| Uso | Técnica | O que ela garante | Se o Redis cair |
|---|---|---|---|
| **Rate limit** (login, cadastro, lance, auditoria, comprovante) | Janela fixa: `INCR` + `EXPIRE NX` num `MULTI` | A contagem e a expiração são atômicas; o TTL restante vira o `Retry-After` | Login, cadastro e lance **falham fechados** (500). Auditoria e comprovante **falham abertos**, porque a prova pública não pode sumir por uma queda de infraestrutura |
| **Limite de chamadas à Scryfall** (2/s na busca, 10/s nas demais) | Reserva de horário (GCRA, um token bucket de capacidade 1) num **script Lua** que usa o relógio do próprio Redis | Duas chamadas nunca começam a menos de um intervalo uma da outra, mesmo com vários processos, sem depender de relógios diferentes | 503 `CATALOGO_INDISPONIVEL` **sem chamar a Scryfall**: sem o bucket, o limite não é garantido |
| **Circuito aberto** da Scryfall | Chave com TTL de 30 s | O circuito fecha sozinho quando a chave expira, sem relógio nem job próprio | O catálogo já responde 503 antes, pelo bucket; o resto do site não depende da Scryfall (RNF-04) |
| **Cache** de busca e de carta | Chave com TTL de 24 h | Menos chamadas ao upstream, expiração nativa | Cache perdido; a vitrine e as salas usam o snapshot do banco |

Três decisões de configuração mostram a intenção: `maxmemory` fixo com `volatile-lru` (o Redis descarta só chaves com TTL e nunca cresce sem limite), **sem persistência** (`--save ''` e `appendonly no`, porque tudo ali é recriável) e a rede interna do Compose, sem porta publicada.

**Por que não o Postgres para isso?** Seria possível, mas cada requisição passaria a gerar uma escrita no mesmo banco onde o lance trava o lote com `FOR UPDATE`. Prefiro que o controle de abuso não dispute o mesmo recurso do caminho crítico. Esse é um raciocínio de projeto, não uma medição que eu tenha feito.

**Por que não memória do processo?** Com uma instância isso funcionaria, e eu reconheço. O que o Redis acrescenta é o estado fora do processo da API (sobrevive a um reinício dela), a atomicidade de `MULTI` e Lua, o TTL nativo e o caminho para mais de um processo sem reescrever o limite.

### Pensando em escala horizontal (e o que o adapter do Socket.IO tem a ver)
Eu sei que o **adapter Redis do Socket.IO não é necessário** na entrega: hoje há uma única instância da API, e a [ADR 0010](specs/decisions/0010-redis.md) diz isso. Quem conecta o navegador à sala ao vivo é o próprio Socket.IO, por WebSocket direto na API; o Redis só repassa mensagens **entre instâncias**. Eu o deixei porque pensei como DevOps: se a API passasse a rodar em várias réplicas atrás de um balanceador (por exemplo, um serviço do ECS com auto scaling atrás de um Application Load Balancer, que aceita WebSocket nativamente), um evento de lance emitido numa instância precisa chegar também aos clientes conectados nas outras. Sem o adapter, ele alcançaria só os clientes daquela instância.

O adapter não está sozinho nessa intenção; o desenho tem outras peças que já pensam em mais de uma instância:
- **Encerramento seguro com N instâncias** (RNF-02 da [spec 010](specs/010-encerramento-e-liquidacao.md)): cada instância tem seu agendador, mas o lote é travado com `FOR UPDATE SKIP LOCKED`, então ele não é liquidado duas vezes.
- **Rate limit e limite da Scryfall no Redis**, não na memória do processo: o contador e o bucket valem para todas as instâncias juntas.
- **Só transporte websocket** ([spec 009](specs/009-tempo-real.md)), que dispensa sticky session no balanceador.

O que eu **não** fiz: testar a aplicação com mais de uma instância, nem tratar os limites de conexão por sala (50 por lote e 200 no total), que hoje são contados na memória de cada instância. Por isso trato a escala horizontal como uma preparação barata, não como uma capacidade comprovada. Também não é um requisito desta entrega; se o prazo apertasse, o adapter seria o primeiro a sair, e a API já cai sozinha para o adapter em memória quando o Redis não está de pé. O lance atômico e a hash chain não são negociáveis.

## Técnica antiadulteração

Qualquer alteração, remoção ou inserção no histórico de lances, mesmo feita direto no banco, é detectada pela auditoria ([specs/008](specs/008-integridade-do-historico.md), [ADR 0005](specs/decisions/0005-integridade-hash-chain-ed25519.md)).

1. **Hash chain por lote:** `hash = SHA-256` da forma canônica do lance (JSON JCS com `criadoEm`, `hashAnterior`, `loteId`, `pseudonimo`, `seq`, `valorCentavos`). O lance 1 parte de `SHA-256("leilao-verzel:genesis:" + loteId)`; mexer num lance quebra todos os seguintes.
2. **Assinatura Ed25519 por lance**, com chave privada que existe só no ambiente da API (nunca no banco, no Git ou em log). Recalcular a cadeia no banco não refaz as assinaturas.
3. **Selo do lote** ao encerrar ou cancelar, assinado, com `totalLances`, `hashFinal`, vencedor e valor. Detecta truncamento e vai no comprovante.
4. **Chaves públicas** publicadas em `GET /api/auditoria/chaves`, inclusive as antigas, então a rotação mantém os lances verificáveis.
5. **Defesas no banco:** triggers recusam `UPDATE`/`DELETE` em `bids`, `lot_seals` e `signing_keys`, e a API só tem `SELECT` e `INSERT` nelas.
6. **Verificação em dois lugares:** a API (`GET /api/auditoria/lotes/{id}`, pública) confere sequência, `hashAnterior`, `hash`, assinatura e selo, citando o `seq` de cada problema; o navegador repete tudo (WebCrypto + `@noble/ed25519`) e mostra qualquer discordância.
7. **Comprovante como âncora externa:** carrega `hashFinal`, `keyId` e a assinatura do selo; quem o guarda prova depois que uma cadeia reassinada é outra.

O `keyId` são os 16 primeiros hex do SHA-256 da chave pública. Como o navegador verifica com a chave que o próprio servidor publica, o fingerprint de produção fica divulgado aqui, fora do servidor, para comparação:

| `keyId` | Algoritmo | Chave pública (base64url) | Ativa desde |
|---|---|---|---|
| `5b8dd12eeb384542` | Ed25519 | `o2XWRyL30VwatKpvZPDqAqNw-SO6LCV25EBLAjNCthY` | 2026-10-26T03:32:23.491Z |

**Limitações conhecidas** ([specs/008](specs/008-integridade-do-historico.md) §Limitações conhecidas):

- **Truncar o fim de um lote ao vivo** (ainda sem selo) com acesso ao banco não é detectado; a âncora externa (OpenTimestamps) ficou fora do escopo. Sinal barato: um `totalLances` recebido ao vivo maior que o da auditoria.
- **Chave privada mais acesso ao banco** forjam o histórico; por isso a chave fica fora do banco.
- **O dono do banco** pode registrar uma chave própria e reassinar uma cadeia; contra ele, a âncora é o comprovante do vencedor.
- **A verificação no navegador prova consistência interna**, não que a chave seja a verdadeira; daí o fingerprint publicado acima.
- **Acima de 1000 lances** a auditoria pública responde 503 em vez de um veredito parcial; lances, selo e comprovante seguem válidos.

### Ver o veredito "adulterado" (só em desenvolvimento)

```sh
DEMO_ADULTERAR=1 pnpm demo:adulterar --lote <id> --seq <n>
```

Soma 1 centavo ao lance `<n>` direto no banco, sem refazer hash nem assinatura, e imprime o comando de restauração (`--restaurar --valor <centavos originais>`). Em `/auditoria/<id>`, servidor e navegador mostram "adulterado" com "lance #n: hash não confere".

## Regras e comportamentos

**Lances** ([specs/007](specs/007-lances-e-regras.md))
- Aceitar um lance é **uma transação** com `FOR UPDATE` no lote: verificação, lance com `seq` contíguo, carteira e novo líder entram juntos ou nada entra. Locks em ordem lote → carteiras por `user_id`, sem deadlock entre lotes; disputa acima de 5 s responde 503.
- "Agora" é o relógio do Postgres; o do cliente só ajusta a contagem exibida.
- **Anti-sniping:** lance a menos de 2 minutos do fim leva o fim para **agora + 2 minutos** (não "fim + 2"); o fim nunca recua ([ADR 0001](specs/decisions/0001-decisoes-iniciais.md)).
- Recusas com código estável e mensagem em pt-BR: lote encerrado, cancelado ou não iniciado, líder cobrindo o próprio lance, abaixo do mínimo (primeiro ≥ inicial; seguintes ≥ atual + incremento), saldo insuficiente, leiloeiro lançando.
- `Idempotency-Key` no lance e no depósito: repetir devolve o original; a mesma chave com outro valor é 422. O lance não é otimista: a tela mostra a resposta do servidor.

**Carteira** ([specs/004](specs/004-carteira-ledger.md)): disponível = total − comprometido. O valor do líder fica comprometido e volta ao disponível na mesma transação em que ele é superado. O ledger é append-only e a projeção `wallet_balances` bate com a soma dele (teste de reconciliação). Só o licitante deposita.

**Encerramento e cancelamento** ([specs/010](specs/010-encerramento-e-liquidacao.md), [ADR 0008](specs/decisions/0008-encerramento-por-varredura.md))
- Um job de 1 s abre e encerra lotes com `FOR UPDATE SKIP LOCKED`; meta de liquidação em até 2 s após o fim. Lance depois de `fim_em` é recusado mesmo antes do job.
- Liquidação numa transação: selo → débito do vencedor → crédito do leiloeiro → comprovante. Lote sem lances fecha sem vencedor.
- Cancelamento só pelo dono, antes de `fim_em`: sela com status `cancelado` e estorna o líder na mesma transação; depois do fim é 409 ([ADR 0035](specs/decisions/0035-ordem-do-cancelamento.md)). O lote some da vitrine, mas mantém a auditoria.

**Scryfall fora do ar** ([specs/005](specs/005-catalogo-scryfall.md)): só a busca do painel depende dela. Dados e imagem da carta viram snapshot na criação do lote, então vitrine, sala, auditoria e comprovante funcionam sem a Scryfall. A API respeita 2 req/s em busca e 10 req/s no resto (token bucket no Redis), usa cache de 24 h e um circuito de 30 s após 429 ou 5 falhas (503 `CATALOGO_INDISPONIVEL`).

**Rate limit** ([specs/003](specs/003-identidade-e-auth.md), [specs/011](specs/011-auditoria-e-comprovante.md))

| Rota | Limite | Se o Redis cair |
|---|---|---|
| Login | 5/min por IP + e-mail | falha fechada |
| Cadastro | 5/min por IP | falha fechada |
| Lance | 10/s por usuário | falha fechada |
| Auditoria e comprovante | 600/min global (limite por IP pendente, tarefa 140) | falha aberta |

**Privacidade e sessão**
- Respostas públicas nunca trazem nome, e-mail ou id de licitante: ele aparece como `Licitante #xxxxxx`, HMAC de `loteId:userId`, estável no lote e diferente entre lotes. Não rotacionar `PSEUDONYM_HMAC_KEY` com lote aberto ([ADR 0031](specs/decisions/0031-complementos-da-f3.md)).
- Dados coletados: nome, e-mail e senha (argon2id). Lances, ledger e comprovantes são permanentes; logs, 14 dias.
- JWT de 15 min e refresh rotativo de 7 dias em cookies `httpOnly`, CSRF por double-submit ([ADR 0006](specs/decisions/0006-autenticacao-jwt-cookies.md)). Papel escolhido no cadastro e imutável; não há administrador.
- Cadastro com e-mail repetido responde 409 (risco aceito, dados de demonstração).
- Websocket com até 50 conexões por lote e 200 no total; a sala se ressincroniza sozinha se perder um evento ([specs/009](specs/009-tempo-real.md)).

## Testes

| Nível | Ferramenta | Escopo |
|---|---|---|
| Unidade | Vitest | regras de lance, ledger, canonicalização, hash chain, verificação, pseudônimo, front |
| Integração | Vitest + Postgres e Redis reais | rotas, 50 lances concorrentes, job de encerramento, triggers, reconciliação |
| Contrato | Vitest + OpenAPI/AsyncAPI | toda resposta de integração validada contra os contratos |
| E2E | Playwright + axe-core | cadastro, depósito, lance → superado, comprovante, adulteração, cancelamento, acessibilidade |

Cobertura mínima de 80% nos módulos de domínio. O CI (GitHub Actions) roda `verify:full --e2e`, `pnpm audit`, gitleaks e CodeQL ([specs/013](specs/013-verificacao-e-testes.md)).

## Deploy e operação

VPS Hostinger (1 vCPU, 4 GB, Ubuntu 24.04) em `https://teste-verzel.duckdns.org`, TLS do Let's Encrypt pelo Caddy, SSH só por chave e firewall com 22, 80 e 443 ([specs/014](specs/014-deploy-e-operacao.md)).

- Documentação da API (Swagger UI) em [`/api/docs`](https://teste-verzel.duckdns.org/api/docs); o contrato em JSON vem de `/api/docs/json` ([ADR 0036](specs/decisions/0036-swagger-ui-em-api-docs.md)).
- Push na `main` com CI verde: imagens construídas no GitHub Actions, publicadas no GHCR e implantadas por SSH com comando forçado; health check falho volta à versão anterior ([docs/deploy.md](docs/deploy.md)).
- Os seis segredos existem só na VPS, em arquivo, e o deploy confere que nenhum aparece nas saídas do Docker. Runbook: [docs/operacao.md](docs/operacao.md).
- Fora da entrega ([ADR 0034](specs/decisions/0034-backup-e-uptime-fora-da-entrega.md)): backup agendado e monitor de uptime; há um `pg_dump` manual. Custo: só o preço fixo da VPS.

## Uso de IA

Construí o projeto com **agentes do Claude Code**, da Anthropic, sob as minhas decisões e aprovações. O processo está em [specs/002](specs/002-organizacao-do-trabalho.md) e nas ADRs [0019](specs/decisions/0019-organizacao-agentes-e-git.md), [0021](specs/decisions/0021-orquestracao-e-agentes-executores.md), [0028](specs/decisions/0028-modelo-e-esforco-por-papel.md) e [0030](specs/decisions/0030-merge-local-por-lote.md).

**Como funcionou**

- **Specs primeiro.** `specs/` é a fonte da verdade; toda mudança de comportamento começa por ela, e decisões viram ADRs. `scripts/agents/check_specs.py` confere a consistência de specs, ADRs, tarefas e links.
- **Orquestrador e papéis** (`.claude/agents/`). Um orquestrador lê a fila de tarefas, propõe lotes de até 3 tarefas sem sobreposição de arquivos, delega e coleta relatórios. Cada executor tem um papel e uma pasta: `spec-guardian` (specs, contratos, docs), `api-dev` (API), `web-dev` (SPA), `db-dev` (schema e migrations), `qa` (integração, e2e e carga) e `infra` (CI/CD, Docker, deploy). Os executores não conversam entre si: tudo passa por tarefas e relatórios de formato fixo (hub-and-spoke, ADR 0021).
- **Modelo por papel** (ADR 0028): os papéis que lidam com dinheiro, lance, concorrência, autenticação e integridade (`api-dev`, `db-dev`) usam o modelo mais forte; os demais, um mais leve.
- **Fronteira garantida por hook.** `scripts/agents/guard_paths.py` bloqueia edições fora das pastas do papel; só o `spec-guardian` altera specs e contratos, e só o `db-dev`, migrations. O hook não cobre escrita via shell; a última barreira é a revisão do diff.
- **Um worktree e uma branch por tarefa** (`tipo/nnn-slug`), commits em Conventional Commits citando a tarefa. Os agentes de papel não commitam: o orquestrador commita e integra.
- **Revisão e verificação.** Cada entrega passa por revisores (code-reviewer sempre; security-reviewer em auth, carteira, lances, integridade e CI/infra; database-reviewer em SQL; typescript-reviewer e react-reviewer conforme o código) e por `pnpm verify:quick`. Achados CRITICAL e HIGH voltam ao agente. A cada lote, `pnpm verify:full` roda na `main` local; a cada 3 lotes, um PR roda o CI completo.
- **Testes primeiro**, com o teste que cobre cada mudança e gate de evidência nos agentes (rastreabilidade à spec, fronteira, ADR).

**O que eu decidi e aprovei**

- Escopo, prazo e a ausência de plano de corte ([ADR 0001](specs/decisions/0001-decisoes-iniciais.md)); a API externa e a stack ([ADR 0002](specs/decisions/0002-api-externa-scryfall.md), [ADR 0011](specs/decisions/0011-stack-backend-frontend.md)); a técnica de integridade; as metas de carga; a produção numa VPS e o que fica fora da entrega (ADRs 0033 e 0034).
- Cada lote, merge, push e PR; dependências de produção; mudanças em contratos, dinheiro, lance ou integridade; qualquer ação com custo ([specs/002](specs/002-organizacao-do-trabalho.md)).
- Toda ação na VPS, no DuckDNS e nos secrets do GitHub: nenhum agente acessa a VPS ([docs/operacao.md](docs/operacao.md)).

**Limites assumidos:** a verificação depende dos testes, das revisões automatizadas e da minha leitura dos relatórios e do diff. Nenhum segredo real é passado aos agentes.

## Créditos

Autor: Eliel Delfino ([@ElielDelfino](https://github.com/ElielDelfino)).

Dados e imagens das cartas: [Scryfall](https://scryfall.com). Este projeto não usa logos da Scryfall nem sugere endosso dela.

Casa de Leilões é um conteúdo de fã não oficial permitido sob a [política de conteúdo de fãs](https://company.wizards.com/pt-br/legal/fancontentpolicy). Não aprovado/apoiado pela Wizards. Porções do material usado são propriedade da Wizards of the Coast. ©Wizards of the Coast LLC.
