# 012 — Frontend: telas

Status: aprovada
Depende de: 003 a 011

## Rotas
| Rota | Acesso | Conteúdo |
|---|---|---|
| `/` | público | vitrine com abas Ao vivo / Agendados / Encerrados, busca, filtros, ordenação, paginação (estado na URL) |
| `/lotes/:id` | público (lance exige licitante) | sala ao vivo (§Sala ao vivo, F3; na F2 era só o detalhe do lote, §Detalhe do lote) |
| `/entrar`, `/cadastro` | anônimo (logado vai ao destino padrão, §Sessão e acesso) | login e cadastro com escolha de papel |
| `/carteira` | licitante | total, comprometido, disponível, depósito, extrato |
| `/meus-arremates` | licitante | abas "Meus lances" e "Arrematados" (§Meus arremates) |
| `/painel` | leiloeiro | resumo (total recebido), lista dos lotes, resultados, cancelar lote (§Cancelar lote) |
| `/painel/lotes/novo` | leiloeiro | busca na Scryfall → formulário do lote |
| `/auditoria/:loteId` | público | auditoria com verificação no navegador (§Auditoria) |
| `/comprovantes/:codigo` | público | comprovante compartilhável (§Comprovante) |
| `*` (qualquer outra) | público | página 404 dentro do layout: `<h1>` e `<title>` "Página não encontrada" (`<title>` com o sufixo " · Casa de Leilões"), link "Voltar à vitrine" para `/`; sem redirecionamento automático |

`/auditoria` e `/comprovantes` sem o parâmetro, e `/meus-arremates/` com subcaminho, não existem: caem na página 404 acima. O `:loteId` e o `:codigo` malformados vão à tela da própria rota (§Auditoria e §Comprovante tratam o 404 da API).

Rota inexistente: o Caddy devolve o `index.html` com HTTP 200 (fallback da SPA) e a página 404 é decidida pelo React Router. Fora da SPA não há fallback: `/api/*` desconhecido → 404 `NAO_ENCONTRADO` (specs/001 §Erros); `/assets/*` ausente → 404 do Caddy.

## Comportamento
- Estado do servidor com TanStack Query; o tempo real atualiza o cache da query (`setQueryData`) a partir dos eventos.
- Lance **não otimista**: o botão fica em "enviando…" e mostra o resultado do servidor. As recusas mapeiam código → mensagem pt-BR:
  - `LANCE_ABAIXO_DO_MINIMO`: "Seu lance precisa ser de pelo menos {minimo}."
  - `SALDO_INSUFICIENTE`: "Saldo disponível insuficiente: você tem {disponivel}."
  - `JA_ESTA_GANHANDO`: "Você já está ganhando este lote."
  - `LOTE_NAO_INICIADO`: "Este lote ainda não começou. Abre em {inicio}."
  - `LOTE_ENCERRADO`: "Este lote já foi encerrado."
  - `LEILOEIRO_NAO_PODE_LANCAR`: "Leiloeiros não podem dar lances."
  - `{minimo}`, `{disponivel}` e `{inicio}` são formatados como dinheiro e data (abaixo); `{minimo}` vem de `detalhes.minimoCentavos` e `{disponivel}` de `detalhes.disponivelCentavos`. `{inicio}` é o `inicioEm` do lote já carregado. `MUITAS_TENTATIVAS` no lance usa a mensagem geral abaixo (com `Retry-After: 1`).
- Erros de sessão e permissão (specs/003), em qualquer tela:
  - `PAPEL_NAO_PERMITIDO`: "Sua conta não tem permissão para esta ação."
  - `SESSAO_EXPIRADA`: "Sua sessão expirou. Entre novamente." (leva a `/entrar?retorno=`, §Sessão e acesso)
  - `NAO_AUTENTICADO` sem sessão recuperável: "Entre para continuar." (leva a `/entrar?retorno=`)
  - `MUITAS_TENTATIVAS`: "Muitas tentativas. Tente de novo em {segundos} s." (`{segundos}` vem do header `Retry-After`)
  - `CSRF_INVALIDO`: "Não foi possível confirmar o envio. Recarregue a página e tente de novo."
- Erros de formulário e de infraestrutura, em qualquer tela:
  - `CREDENCIAIS_INVALIDAS`: "E-mail ou senha incorretos."
  - `EMAIL_EM_USO`: "Já existe uma conta com este e-mail."
  - `DADOS_INVALIDOS`: "Confira os campos destacados."
  - `NAO_ENCONTRADO`: "Não encontramos o que você procurou."
  - `INDISPONIVEL` e falha de rede (sem resposta da API): "O serviço está indisponível agora. Tente de novo em instantes."
  - `CATALOGO_OCUPADO`: "A busca de cartas está ocupada. Tente de novo em {segundos} s."
  - `CATALOGO_INDISPONIVEL`: "A busca de cartas está indisponível agora. Tente de novo em {segundos} s."
  - Nos dois, `{segundos}` é `detalhes.tenteNovamenteEm` (inteiro ≥ 1; specs/005), com o `Retry-After` como reserva se o campo faltar.
- Mensagens por campo, mostradas junto ao campo quando a validação do formulário no navegador (os mesmos limites de specs/003 e specs/004) o recusa, ligadas por `aria-describedby`; a recusa 422 do servidor mostra só a mensagem geral de `DADOS_INVALIDOS`:
  - nome: "Use de 2 a 80 caracteres."
  - e-mail: "Informe um e-mail válido."
  - senha do cadastro: "Use de 10 a 128 caracteres."
  - senha do login: "Informe a senha."
  - papel: "Escolha Licitante ou Leiloeiro."
  - valor do depósito: "Informe um valor entre R$ 1,00 e R$ 100.000,00."
- Sucesso do depósito: "Depósito de {valor} registrado." (`{valor}` no formato de dinheiro abaixo).
- Rótulos do extrato por `tipo` de lançamento (specs/004):
  - `deposito`: "Depósito"
  - `compromisso`: "Valor reservado para lance"
  - `liberacao`: "Valor liberado (lance superado)"
  - `estorno`: "Estorno de lote cancelado"
  - `debito_arremate`: "Pagamento de arremate"
  - `credito_arremate`: "Recebimento de arremate"
- Sinal e cor do valor no extrato: a API manda `valorCentavos` sempre positivo; o front mostra o sinal pelo `tipo`, visto pelo saldo disponível: `deposito`, `credito_arremate`, `liberacao` e `estorno` com "+" (verde); `debito_arremate` com "−" (vermelho); `compromisso` com "−" (âmbar, valor reservado). O sinal é parte do texto, nunca só a cor.
- Saldo da carteira: "Total" na cor do texto, "Comprometido" em âmbar e "Disponível" em verde; cada valor continua com o seu rótulo.
- Identidade visual: cores só por tokens (`fundo`, `superficie`, `poco`, `texto`, `texto-suave`, `borda`, `primario`, `destaque`, `sucesso`, `perigo`, `aviso`), com contraste AA nos dois temas; fonte Outfit servida pelo próprio app (`font-src 'self'`). As abas e a navegação em pílula têm um fundo da pílula ativa que desliza até a nova ativa; é só visual (`aria-hidden`), sem mudar papéis nem estados ARIA, e não anima com `prefers-reduced-motion`.
- Sala: botão de lance rápido com o valor mínimo pré-preenchido; indicador "Você está ganhando" / "Você foi superado" com cor **e** ícone **e** texto (não só cor); contagem regressiva corrigida pelo relógio do servidor; destaque visual quando o fim é estendido. Detalhes em §Sala ao vivo.
- Dinheiro sempre por `Intl.NumberFormat('pt-BR', {style: 'currency', currency: 'BRL'})`; datas em `America/Sao_Paulo`.
- Dark mode: tokens CSS em `:root` e `[data-theme="dark"]`; segue `prefers-color-scheme` por padrão; alternância salva no `localStorage`.
- Acessibilidade (WCAG 2.2 AA): navegação por teclado, foco visível, `aria-live="polite"` para novos lances e `assertive` para "superado", contraste AA nos dois temas, alvos ≥ 24×24 px, `prefers-reduced-motion` respeitado.
- Foco ao trocar de rota: quando o `pathname` muda, o foco vai para o `<main id="conteudo" tabindex="-1">` (o link "Pular para o conteúdo" aponta para ele). O foco **não** é movido na primeira carga nem quando só mudam a query string ou o hash.
- Imagens das cartas conforme as regras da Scryfall (specs/005) e a CSP (§Painel do leiloeiro, "Imagens e CSP"); rodapé conforme §Rodapé.
- Sessão, acesso por rota e cabeçalho: §Sessão e acesso. Falha inesperada de página: §Estado de erro.
- Telas da F2: §Vitrine, §Detalhe do lote, §Painel do leiloeiro e §Novo lote. Telas da F3: §Sala ao vivo (que substitui o detalhe) e §Vitrine ao vivo. Telas da F4: §Auditoria, §Comprovante, §Meus arremates e §Cancelar lote (no painel); a sala ganha o link "Ver auditoria" nos estados encerrada e cancelada.
- `MUITAS_TENTATIVAS` (com `Retry-After`) também vale na auditoria e no comprovante, que têm rate limit (teto global até a tarefa 020 e limite por IP depois; specs/011 §Rate limit); a mensagem é a geral acima.
- **Links e imagens que vêm da API (F4):** a SPA nunca usa a URL do servidor direto em `href` nem em `src`. Ela extrai o identificador e monta a URL ela mesma: de `auditoriaUrl` (`/auditoria/{loteId}`) tira o `loteId` com o formato `^/auditoria/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$` e monta `/auditoria/${encodeURIComponent(loteId)}`; de `imagemUrl` (`/api/imagens/{snapshotId}`) tira o `snapshotId` do mesmo modo e monta `/api/imagens/${encodeURIComponent(snapshotId)}`. Valor que não casa com o formato não vira link nem imagem (o link "Ver auditoria" não aparece; a imagem cai em "Sem imagem"). O `:codigo` do comprovante e o `:loteId` da auditoria entram em qualquer URL com `encodeURIComponent` (inclusive o do botão "Copiar link").

## Sessão e acesso
Sessão (ADR 0006, specs/003):
- No carregamento, a SPA chama `GET /api/auth/me`. Com 200, a sessão é do usuário devolvido; com 401, tenta o refresh abaixo e, se ele também falhar, o usuário é anônimo, **sem mensagem** (nem `SESSAO_EXPIRADA`).
- Um 401 `NAO_AUTENTICADO` de qualquer requisição dispara `POST /api/auth/refresh`, **um por vez**: requisições que recebem 401 enquanto um refresh está em andamento esperam esse mesmo refresh. Com o refresh em 204, cada requisição original é repetida **uma única vez**; se a repetição devolver 401, não há novo refresh e vale "Entre para continuar." (`NAO_AUTENTICADO`).
- Refresh em 401 durante o uso: mostra a mensagem de `SESSAO_EXPIRADA`, descarta os dados da sessão do cache e vai para `/entrar?retorno=<caminho>`, em que `<caminho>` é a rota em que o usuário estava (caminho e query, codificados).
- Os POST usam o CSRF de specs/003 (`GET /api/auth/csrf` só quando falta o cookie `csrf_token`).

Acesso por rota (papéis da tabela de §Rotas):
- Anônimo em rota restrita (`/carteira`, `/meus-arremates`, `/painel`, `/painel/lotes/novo`) → vai para `/entrar?retorno=<caminho>`, sem mensagem.
- Papel errado em rota restrita → página "Acesso não permitido" dentro do layout: `<h1>` e `<title>` "Acesso não permitido" (com o sufixo " · Casa de Leilões"), a mensagem de `PAPEL_NAO_PERMITIDO` e o link "Voltar à vitrine" para `/`; sem redirecionamento automático.
- Usuário logado em `/entrar` ou `/cadastro` → vai para o destino padrão do papel, sem mostrar o formulário.
- Destino padrão: `/` para licitante e `/painel` para leiloeiro.
- Destino depois de entrar ou de cadastrar-se: o `retorno`, se for caminho interno (começa com `/`, não começa com `//` e não contém `\`) e permitido ao papel (não restrito a outro papel); caso contrário, o destino padrão.
- Contas de demonstração: abaixo de "Ainda não tem conta? Criar conta", `/entrar` lista as três contas do seed (specs/003 RF-03) para quem avalia o projeto: Leiloeiro `leiloeiro@demo.local`, Licitante `helena@demo.local` e Licitante `otavio@demo.local`, com a senha `leilao-demo-2026`. A senha é pública de propósito (ADR 0023) e o texto fica selecionável para copiar; a lista não preenche o formulário.

Cabeçalho:
- Anônimo: "Entrar" e "Criar conta".
- Licitante: "Carteira" e "Meus arremates".
- Leiloeiro: "Painel".
- Logado: o nome do usuário e "Sair" (chama `POST /api/auth/logout` e descarta os dados da sessão do cache).

## Estado de erro
Falha inesperada de renderização ou de carregamento de rota (task 019; substitui a tela padrão do React Router, em inglês e com o stack):
- `<h1>` e `<title>` "Algo deu errado" (`<title>` com o sufixo " · Casa de Leilões"); parágrafo "Não foi possível mostrar esta página. Tente recarregar ou volte à vitrine."; `role="alert"` envolvendo o `<h1>` e o parágrafo; link "Voltar à vitrine" para `/`.
- A mensagem interna do erro nunca aparece na tela.
- Dois níveis: o erro de uma página aparece dentro do layout (no lugar do `<Outlet>`, com cabeçalho e rodapé); a falha do próprio layout mostra um `<main id="conteudo">` com a mesma tela e o rodapé, sem o cabeçalho.
- Fora de escopo: sincronização do tema entre abas.

## Vitrine (`/`)
Tela pública da F2 (specs/006 §Vitrine). `<h1>` e `<title>` "Vitrine" (`<title>` com o sufixo " · Casa de Leilões").

Rótulos de status e de raridade (usados também no detalhe, no painel e no novo lote):
- status: `ao_vivo` "Ao vivo", `agendado` "Agendado", `encerrado` "Encerrado", `cancelado` "Cancelado";
- raridade: `common` "Comum", `uncommon` "Incomum", `rare` "Rara", `mythic` "Mítica", `special` "Especial", `bonus` "Bônus".

Controles, nesta ordem:
- Abas (`role="tablist"`, cada uma `role="tab"` com `aria-selected`): "Ao vivo", "Agendados", "Encerrados", ligadas a `status` `ao_vivo`, `agendado`, `encerrado`. A aba padrão é "Ao vivo". Trocar de aba aplica na hora.
- Formulário `role="search"` com os campos "Buscar por título ou carta" (`type="search"`, `maxlength="100"`), "Raridade" (opções "Todas" e as seis raridades acima), "Preço mínimo (R$)" e "Preço máximo (R$)" (texto em reais no formato pt-BR, como "1.234,56", até duas casas) e os botões "Filtrar" e "Limpar filtros". Texto vazio ou só com espaços não filtra. "Limpar filtros" remove `q`, `raridade`, `precoMin` e `precoMax` (mantém a aba e a ordenação).
- "Ordenar por" (`<select>`): "Termina antes", "Mais recente", "Maior lance" (`termina_antes`, `mais_recente`, `maior_lance`). Trocar aplica na hora.
- Mensagens por campo (validação no navegador, ligadas por `aria-describedby`; com erro a consulta não é enviada): preço mínimo ou máximo mal formado ou fora de R$ 0,00 a R$ 100.000.000,00: "Informe um valor entre R$ 0,00 e R$ 100.000.000,00."; máximo menor que o mínimo: "O preço máximo deve ser maior ou igual ao mínimo." (no campo do máximo).

Estado na URL (a vitrine inteira se reconstrói da URL):
- Parâmetros `status`, `q`, `raridade`, `precoMin`, `precoMax` (centavos inteiros), `ordem` e `pagina`. Valores padrão não aparecem (`status=ao_vivo`, `ordem=termina_antes`, `pagina=1`).
- Mudar aba, busca, filtro ou ordenação volta `pagina` para 1; cada mudança cria uma entrada de histórico. Parâmetro desconhecido ou com valor inválido na URL é ignorado (vale o padrão).
- `pagina` acima da última (com `total` > 0) troca a URL, sem nova entrada de histórico, para a última página.

Lista (`<ul>` dentro de `role="tabpanel"`), 24 lotes por página. Cada item é um `<li>` com:
- imagem de `imagemUrl`, `alt="Carta {cartaNome}"`, `object-fit: contain`, proporção reservada para o layout não pular, `loading="lazy"`;
- título em `<h2>` que é o link para `/lotes/{id}`;
- a raridade (rótulo acima);
- uma linha de preço: encerrado com `valorArremateCentavos` → "Arrematado por {valor}"; encerrado sem `valorArremateCentavos` e sem `lanceAtualCentavos` → "Encerrado sem lances"; com `lanceAtualCentavos` → "Lance atual: {valor}"; sem lance → "Lance inicial: {valor}";
- "Nenhum lance", "1 lance" ou "{n} lances";
- uma linha de horário: ao vivo "Termina em {data e hora}"; agendado "Começa em {data e hora}"; encerrado "Encerrado em {data e hora}" (usa `fimEm`).

Estados:
- Total, acima da lista, com `aria-live="polite"` (com `total` > 0): "1 lote encontrado" ou "{n} lotes encontrados".
- Carregando: `role="status"` "Carregando lotes…" e a lista com `aria-busy="true"`.
- Vazio sem filtros: aba "Ao vivo" "Nenhum lote ao vivo agora."; "Agendados" "Nenhum lote agendado."; "Encerrados" "Nenhum lote encerrado ainda.".
- Vazio com `q`, `raridade`, `precoMin` ou `precoMax`: "Nenhum lote encontrado com estes filtros." e o botão "Limpar filtros".
- Falha da consulta: a mensagem do código (`INDISPONIVEL` e falha de rede: "O serviço está indisponível agora. Tente de novo em instantes.") com o botão "Tentar de novo".
- Paginação (`<nav aria-label="Paginação">`, só com mais de uma página): "Anterior", "Próxima" e "Página {pagina} de {totalPaginas}", com `totalPaginas` = ⌈`total` / 24⌉; nas pontas o botão fica com `aria-disabled="true"` e não navega.

## Detalhe do lote (`/lotes/:id`, F2)
Tela pública (specs/006 §Detalhe) que a F3 substitui pela sala ao vivo (§Sala ao vivo; os textos de carta e de lote abaixo continuam valendo nela). Na F2 não há campo nem botão de lance.
- `<h1>` e `<title>` = título do lote (`<title>` com o sufixo " · Casa de Leilões"); enquanto carrega, `role="status"` "Carregando lote…" e `<title>` "Lote · Casa de Leilões".
- Lote inexistente (404): `<h1>` e `<title>` "Lote não encontrado", o texto de `NAO_ENCONTRADO` e o link "Voltar à vitrine" para `/`, dentro do layout.
- Imagem de `imagemUrl` com `alt="Carta {nome}"` e `object-fit: contain`; abaixo, quando houver `artista`, "Ilustração: {artista}".
- Dados da carta: "Carta: {nome}", "Coleção: {colecao}", "Raridade: {rótulo}", "Tipo: {tipo}" e, se houver, o texto do oráculo em um parágrafo.
- Dados do lote: o status (rótulo com ícone **e** texto), "Descrição" (só se houver), "Lance inicial: {valor}", "Incremento mínimo: {valor}", "Lance atual: {valor}" ou, sem lance, "Nenhum lance ainda.", o número de lances ("Nenhum lance", "1 lance" ou "{n} lances"), "Início: {data e hora}", "Fim: {data e hora}" e, só se `fimOriginalEm` for diferente de `fimEm`, "Fim original: {data e hora}".
- `suaPosicao`: `ganhando` mostra "Você está ganhando este lote."; `venceu` mostra "Você venceu este lote."; `null` não mostra nada.
- Lote `cancelado`: `role="status"` "Este lote foi cancelado."
- Link "Voltar à vitrine" para `/` no fim da página.

## Sala ao vivo (`/lotes/:id`, F3)
Substitui o detalhe. Tela pública; o lance exige licitante. Dados estáticos (carta, descrição, título, imagem) de `GET /api/lotes/{id}`; estado vivo do ack de `entrar_lote` (specs/009), que a sala refaz na reconexão e a cada 30 s sem evento numa sala ao vivo. Valem os textos de §Detalhe do lote (título, carta, dados do lote, "Voltar à vitrine"), com as mudanças abaixo: o lance atual, o número de lances, o fim e o status vêm do estado vivo e se atualizam pelos eventos (`lance_aceito`, `fim_estendido`); a linha "Fim original" aparece quando difere de `fimEm`.

### Estados da sala
- **Carregando:** `role="status"` "Carregando sala…" até chegarem o detalhe e o estado; `<title>` "Lote · Casa de Leilões".
- **Erro:** lote inexistente (404 ou ack `NAO_ENCONTRADO`) → `<h1>` "Lote não encontrado" como no detalhe; falha do detalhe ou do ack (`INDISPONIVEL`, rede) → a mensagem do código e o botão "Tentar de novo"; `SALA_CHEIA` → "Esta sala está cheia agora. Tente de novo em instantes." com o botão "Tentar de novo". Com a sala já aberta, a perda da conexão mostra `role="status"` "Reconectando…" e some quando o novo `entrar_lote` responde; o formulário de lance fica desabilitado nesse intervalo.
- **Sem lances** (ao vivo, `totalLances` 0): "Nenhum lance ainda. O primeiro lance deve ser de pelo menos {valor}." (lance inicial).
- **Ganhando** (`suaPosicao` `ganhando`): ícone de check **e** texto "Você está ganhando este lote."
- **Superado** (`superado`): ícone de alerta **e** texto "Você foi superado. O lance atual é {valor}."
- **Encerrada** (status `encerrado`): `role="status"` "Este lote foi encerrado."; com `valorArremateCentavos`, também "Arrematado por {valor}."; `venceu` mostra "Você venceu este lote." e `perdeu` "Você não venceu este lote."; link "Ver auditoria" para `/auditoria/{id}`. Sem formulário.
- **Cancelada** (`cancelado`): `role="status"` "Este lote foi cancelado."; link "Ver auditoria" para `/auditoria/{id}`. Sem formulário.
- **Agendada** (`agendado`): "Este lote ainda não começou. Abre em {inicio}." Sem formulário.
- `sem_lance` não mostra indicador. A posição vem de `suaPosicao` e é atualizada pelos eventos: `lance_aceito` com o `seuPseudonimo` do usuário → `ganhando`; `voce_foi_superado` do lote → `superado`; `lance_aceito` de outro pseudônimo com o usuário `ganhando` também → `superado`. Anônimo e leiloeiro não têm indicador.

### Relógio, histórico e destaque do fim estendido
- Contagem regressiva `role="timer"` "Termina em {HH:MM:SS}" (com dias: "{d} d {HH:MM:SS}"), corrigida por `agoraServidor`: diferença entre `agoraServidor` e o relógio local no instante em que o estado chegou, somada ao relógio local a cada segundo. Ao chegar a zero mostra "Encerrando…" até o evento de encerramento ou o resync; nunca mostra tempo negativo. Sem `aria-live` no cronômetro (não anuncia a cada segundo); o texto estático "Fim: {data e hora}" fica ao lado.
- Histórico "Últimos lances": `<ol>` com até 50 lances, do mais recente ao mais antigo; cada item "{pseudonimo} · {valor} · {data e hora}" (dd/mm/aaaa, hh:mm:ss em `America/Sao_Paulo`), com "(você)" no do próprio usuário; vazio: o texto de "Sem lances". Um lance novo entra no topo e o 51º sai. O histórico completo está na auditoria (F4).
- **Fim estendido:** ao receber `fim_estendido`, a contagem ganha um selo com ícone **e** texto "Fim estendido" por 10 s e um `role="status"` anuncia "O fim do lote foi estendido para {data e hora}."; o destaque é borda e texto, não só cor, e não anima com `prefers-reduced-motion`.
- **Extensão vista só no resync** (o fim mudou durante uma queda ou entre resyncs): se o estado de um resync chega com `fimEm` maior que o do estado local, a sala age como se tivesse recebido `fim_estendido`: selo "Fim estendido" por 10 s e um único anúncio "O fim do lote foi estendido para {data e hora}.". Com `fimEm` igual, o resync preserva o aviso anterior em vez de apagá-lo. A primeira entrada na sala nunca anuncia.

### Anúncios (aria-live)
- Região `aria-live="polite"`: novo lance de outro licitante ("Novo lance de {valor} por {pseudonimo}.") e o sucesso do próprio lance ("Lance de {valor} registrado.").
- Região `aria-live="assertive"` (`role="alert"`): só "Você foi superado. O lance atual é {valor}."; não anuncia o próprio lance aceito.

### Formulário de lance
- Aparece só para **licitante autenticado** com lote ao vivo (por `inicioEm`, `fimEm` e `agoraServidor`). Leiloeiro vê "Leiloeiros não podem dar lances."; anônimo vê "Entre como licitante para dar lances." com o link "Entrar" para `/entrar?retorno=` com o caminho da sala.
- Campos: "Valor do lance (R$)" (texto em reais pt-BR, como "150,00", até duas casas, convertido por texto em centavos inteiros, sem `float`), com a dica "Lance mínimo: {valor}" (lance inicial se não há lance; senão lance atual + incremento, specs/007), e dois botões: "Dar lance" e "Dar lance mínimo ({valor})", que envia o mínimo sem digitar. O campo nasce preenchido com o mínimo e é atualizado com o novo mínimo a cada `lance_aceito` (sem apagar o que o usuário está digitando se ele já editou).
- Mensagem por campo (validação no navegador, `aria-describedby`; não envia): valor mal formado, zero ou acima de R$ 90.071.992.547.409,91 → "Informe um valor em reais, como 150,00."
- Envio: `POST /api/lotes/{id}/lances` sem otimismo. Enquanto envia, os dois botões ficam desabilitados e "Dar lance" mostra "Enviando…"; uma trava síncrona impede dois envios no mesmo tick. A `Idempotency-Key` é um UUID novo por tentativa e é **reusada** se o usuário repete a mesma tentativa (mesmo valor) depois de uma falha sem resposta (rede, 503); depois de qualquer resposta definitiva (201, 200 ou recusa 4xx) a chave é descartada.
- Resultado: 201 ou 200 → "Lance de {valor} registrado." Recusas pela tabela de §Comportamento: `LANCE_ABAIXO_DO_MINIMO` mostra o mínimo e preenche o campo com ele; `SALDO_INSUFICIENTE` mostra o disponível e o link "Ir para a carteira" para `/carteira`; `LOTE_ENCERRADO` e `LOTE_NAO_INICIADO` também fazem um resync do estado; `MUITAS_TENTATIVAS` mostra os segundos de `Retry-After`; `DADOS_INVALIDOS`, `INDISPONIVEL` e rede, os textos gerais.

## Vitrine ao vivo (F3)
Na vitrine (§Vitrine), a página entra no room `vitrine` ao montar e sai ao desmontar (specs/009 §Vitrine). `lance_aceito` atualiza no card o "Lance atual: {valor}", o número de lances e o fim; `fim_estendido` atualiza o horário; `lote_iniciado`, `lote_encerrado` e `lote_cancelado` refazem a consulta da lista. Os eventos só mexem nos cards visíveis, sem recarregar a página, sem mover o foco nem mudar a ordem da lista que o usuário vê; a lista se reordena na próxima consulta. Os cards não têm `aria-live` (para não anunciar cada lance de todos os lotes). Na reconexão a lista é consultada de novo. Enquanto a consulta troca de página ou filtro, a lista anterior continua visível com `aria-busy="true"` (sem piscar) e o foco é preservado.

## Painel do leiloeiro (`/painel`)
`<h1>` e `<title>` "Painel do leiloeiro" (com o sufixo). Acesso: §Sessão e acesso (só leiloeiro).
- Aviso de sucesso: depois de criar um lote, `role="status"` "Lote criado." no topo, só nessa visita (não persiste ao recarregar).
- Link "Novo lote" para `/painel/lotes/novo`.
- Resumo (`<dl>` sob o título "Resumo"): "Total recebido" (valor), "Lotes arrematados" (número) e "Lotes sem lance" (número), de `GET /api/painel/resumo`.
- Lista "Meus lotes": `<table>` com `<caption>` "Meus lotes" e as colunas "Lote" (título, link para `/lotes/{id}`), "Status" (rótulo), "Início", "Fim", "Lances" (número), "Resultado" e "Ações". "Resultado": encerrado com `valorArremateCentavos` → "Arrematado por {valor}"; encerrado sem ele → "Sem arremate"; qualquer outro status → "—". "Ações" (usa o status derivado da resposta): `agendado` e `ao_vivo` → botão "Cancelar lote" (§Cancelar lote); `encerrado` e `cancelado` → link "Auditoria" para `/auditoria/{id}` (`aria-label="Auditoria do lote {título}"`). 24 por página, mesma paginação da vitrine, `pagina` na URL.
- Carregando: `role="status"` "Carregando seus lotes…". Vazio: "Você ainda não criou lotes." Falha: mensagem do código e o botão "Tentar de novo".

### Cancelar lote
Rota de API: `POST /api/painel/lotes/{id}/cancelamento` (specs/010 §Cancelamento; CSRF pelo cliente existente).
- O botão "Cancelar lote" (`aria-label="Cancelar lote {título}"`) abre um diálogo (`role="dialog"`, `aria-modal="true"`, rotulado pelo título). Título "Cancelar este lote?"; texto "O lote "{título}" será cancelado e não poderá ser reaberto. Se houver um líder, o valor reservado para o lance dele será estornado."; botões "Confirmar cancelamento" e "Manter lote".
- Foco preso no diálogo; o foco inicial vai para "Manter lote"; Esc e "Manter lote" fecham sem chamar a API e devolvem o foco ao botão que abriu o diálogo.
- Enquanto envia: "Confirmar cancelamento" mostra "Cancelando…", os dois botões ficam desabilitados e uma trava síncrona impede dois envios no mesmo tick.
- Sucesso (200): fecha o diálogo, invalida a lista e o resumo, e mostra `role="status"` no topo "Lote cancelado. Se havia líder, o valor reservado foi estornado." (só nessa visita, como "Lote criado."); o foco vai para esse aviso. O resumo também é refeito quando a janela recupera o foco.
- 409 `LOTE_ENCERRADO`: fecha o diálogo, refaz a lista e mostra `role="alert"` "Não foi possível cancelar: o lote já foi encerrado ou cancelado."
- 404: fecha o diálogo, refaz a lista e mostra `role="alert"` "Não encontramos este lote. A lista foi atualizada."
- Os demais erros (`INDISPONIVEL`, rede, `PAPEL_NAO_PERMITIDO`, `CSRF_INVALIDO`, `MUITAS_TENTATIVAS`) usam as mensagens gerais de §Comportamento, dentro do diálogo, que continua aberto com os botões habilitados.

### Imagens e CSP (ADR 0029)
A CSP do site todo permite `https://cards.scryfall.io` em `img-src`, e a navegação interna do roteador vale em todas as rotas, inclusive ao entrar e sair do painel. Só a busca do novo lote exibe `<img>` com origem em `cards.scryfall.io` (com `referrerpolicy="no-referrer"`); vitrine, detalhe do lote, sala, auditoria, comprovante e o resto do painel usam só `/api/imagens/{snapshotId}`.

## Novo lote (`/painel/lotes/novo`)
`<h1>` e `<title>` "Novo lote" (com o sufixo). Dois passos na mesma rota.

Passo 1, "Buscar carta":
- Campo "Buscar carta na Scryfall" (`maxlength="200"`) com a dica "Digite o nome da carta ou use a sintaxe de busca da Scryfall." e o botão "Buscar cartas". Vazio, só espaços ou mais de 200 caracteres: "Digite de 1 a 200 caracteres." (no campo, `aria-describedby`; não envia).
- `q` e `pagina` ficam na URL (`?q=&pagina=`); a lista de resultados se reconstrói dela.
- Carregando: `role="status"` "Buscando cartas…". Total (`aria-live="polite"`): "1 carta encontrada" ou "{n} cartas encontradas". Vazio (total 0): "Nenhuma carta encontrada para esta busca."
- Cada resultado (`<li>`): miniatura de `imagemUrl` com `referrerpolicy="no-referrer"` e `alt="Carta {nome}"` (sem `imagemUrl`: o texto "Sem imagem"), `{nome}`, "{colecao} · {raridade em pt-BR}", `{tipo}`, "Arte: {artista}" (se houver) e o botão "Escolher esta carta" (`aria-label="Escolher {nome}"`).
- Paginação como a da vitrine, com 25 por página e `totalPaginas` = ⌈`total` / 25⌉, no máximo 500.
- Erros: `CATALOGO_OCUPADO` e `CATALOGO_INDISPONIVEL` (§Comportamento); 422 com `detalhes.campo` = `q`: "A Scryfall não entendeu esta busca. Confira a sintaxe."; os demais, pela lista de §Comportamento. Depois de qualquer falha a busca pode ser repetida pelo mesmo botão.

Passo 2, "Dados do lote" (depois de "Escolher esta carta"): mostra a carta escolhida (miniatura e nome) e o botão "Trocar carta" (volta ao passo 1 com os resultados). Campos, nesta ordem:
- "Título (opcional)" (`maxlength="120"`), com a dica "Se ficar em branco, usamos o nome da carta.";
- "Descrição (opcional)" (`<textarea maxlength="2000">`);
- "Lance inicial (R$)" e "Incremento mínimo (R$)": texto em reais pt-BR; mal formado ou fora de R$ 1,00 a R$ 1.000.000,00: "Informe um valor entre R$ 1,00 e R$ 1.000.000,00.";
- caixa "Começar agora", marcada por padrão; marcada, o campo "Início" fica desabilitado e o `inicioEm` enviado é o instante do envio;
- "Início" e "Fim" (`type="datetime-local"`), interpretados em `America/Sao_Paulo`; vazio: "Informe a data e a hora."; início mais de 1 minuto no passado: "O início não pode ser mais de 1 minuto no passado."; fim menos de 5 minutos depois do início: "O fim deve ser pelo menos 5 minutos depois do início."; duração acima de 7 dias: "A duração máxima é de 7 dias." (no campo do fim);
- botão "Criar lote". Enquanto a requisição está em andamento fica desabilitado e com o texto "Criando…" (não há `Idempotency-Key` na criação, specs/006).

Título e descrição têm `maxlength`, então não têm mensagem de erro própria. As mensagens por campo aparecem no navegador antes do envio; a recusa 422 do servidor mostra só a mensagem geral de `DADOS_INVALIDOS`, **exceto** com `detalhes.campo` = `scryfallId`, que mostra "Não foi possível usar esta carta. Escolha outra." e volta ao passo 1. Falhas 503 do snapshot usam as mensagens de `CATALOGO_OCUPADO` e `CATALOGO_INDISPONIVEL`. Sucesso (201): vai para `/painel` com o aviso "Lote criado.".

## Auditoria (`/auditoria/:loteId`)
Tela pública (specs/011, specs/008). `<h1>` e `<title>` "Auditoria do lote" (`<title>` com o sufixo " · Casa de Leilões"). Dados de `GET /api/auditoria/lotes/{id}` e `GET /api/auditoria/chaves`, sem cache do veredito. Sem imagem de carta.

Seções, nesta ordem:
- **Cabeçalho do lote** (`<dl>`): "Lote: {titulo}", "Carta: {cartaNome}", "Status: {rótulo}" (rótulos de §Vitrine, com ícone **e** texto), "Início: {data e hora}", "Fim: {data e hora}", "Lances registrados: {n}" ("Nenhum lance", "1 lance" ou "{n} lances") e o link "Ver lote" para `/lotes/{id}`.
- **Veredito do servidor** (`<h2>` "Veredito do servidor"): `integro` → ícone de check **e** texto "Íntegro: o servidor não encontrou adulteração."; `adulterado` → ícone de alerta **e** texto "Adulterado: o servidor encontrou 1 problema." ou "Adulterado: o servidor encontrou {n} problemas.".
- **Problemas** (`<h2>` "Problemas encontrados", só com problemas; `<ul>`): cada item "lance #{seq}: {descrição}" e, nos problemas do selo (`seq` nulo), "selo: {descrição}". A descrição vem do **código** (não do campo `mensagem` do servidor): `SEQ_FORA_DE_ORDEM` "sequência fora de ordem"; `HASH_ANTERIOR_DIVERGENTE` "hash anterior não confere"; `HASH_DIVERGENTE` "hash não confere"; `ASSINATURA_INVALIDA` "assinatura inválida"; `CHAVE_DESCONHECIDA` "chave de assinatura desconhecida"; `SELO_TOTAL_DIVERGENTE` "total de lances não confere com o selo"; `SELO_HASH_FINAL_DIVERGENTE` "hash final não confere com o selo"; `SELO_ASSINATURA_INVALIDA` "assinatura do selo inválida". Exemplo: "lance #4: hash não confere".
- **Verificação no navegador:** botão "Verificar no meu navegador" (specs/008 §Verificação). Enquanto verifica, o botão fica desabilitado com o texto "Verificando…". O resultado aparece em uma região `aria-live="polite"` (`role="status"`), que existe desde o início e começa vazia:
  - íntegro: "Verificação no seu navegador: íntegro. Hashes, assinaturas e selo conferem.";
  - adulterado: "Verificação no seu navegador: adulterado ({n} problemas)." (ou "(1 problema)"), seguida da lista de problemas no mesmo formato de §Problemas, com o `<h2>` "Problemas encontrados no seu navegador";
  - concordância: "O resultado do seu navegador é igual ao do servidor.";
  - discordância (veredito diferente, ou o mesmo veredito com outra lista de problemas, comparando código e `seq`): `role="alert"` "Atenção: o resultado do seu navegador é diferente do resultado do servidor." A discordância é mostrada, nunca escondida;
  - contexto sem `crypto.subtle` (página fora de HTTPS): `role="alert"` "Seu navegador não permite a verificação nesta página. Abra o site por uma conexão segura (HTTPS) e tente de novo." Sem veredito;
  - falha inesperada ou da consulta de chaves: `role="alert"` "Não foi possível verificar agora. Tente de novo em instantes."
  - um `keyId` que falta na lista de chaves faz a tela refazer `GET /api/auditoria/chaves` uma vez antes de acusar `CHAVE_DESCONHECIDA` (specs/008).
  - **Limitação da verificação (specs/008 §Limitações conhecidas):** a verificação no navegador, sem âncora externa, prova **consistência interna** (a cadeia e as assinaturas conferem entre si e com a chave que o próprio servidor publica), não que a chave seja a verdadeira. Por isso, depois de qualquer resultado (íntegro, adulterado ou discordância), a mesma região mostra o parágrafo fixo "Chave pública usada na verificação: {keyId}. O servidor publica esta chave; para ter certeza de que é a verdadeira, compare este código com o publicado fora do servidor (README do projeto e página da versão)." com um `keyId` por chave usada (separados por ", "). O `keyId` é o fingerprint da chave pública (16 primeiros hexadecimais de SHA-256 da chave, specs/008 §Chaves). O fingerprint é publicado fora do servidor no README e na release (F5, specs/014); a tela não promete mais do que isso.
- **Selo** (`<h2>` "Selo do lote"): sem selo (`selo` nulo) → "Este lote ainda não foi selado. O selo é gerado no encerramento ou no cancelamento."; com selo, `<dl>`: "Situação" ("Encerrado" ou "Cancelado"), "Total de lances", "Hash final", "Vencedor" (pseudônimo ou "—"), "Valor do arremate" (valor ou "—"), "Selado em", "Chave de assinatura" (`keyId`) e "Assinatura".
- **Lances** (`<h2>` "Lances do lote"): sem lances → "Nenhum lance foi registrado neste lote."; senão `<table>` com `<caption>` "Lances do lote" e as colunas "Nº" (`seq`), "Licitante" (pseudônimo), "Valor", "Horário" (data e hora) e "Hash". A célula "Hash" é um `<details>` cujo `<summary>` mostra os 8 primeiros caracteres do `hash` seguidos de "…" e cujo conteúdo traz, em `<code>`, "Hash: {hash}", "Hash anterior: {hashAnterior}", "Chave: {keyId}" e "Assinatura: {assinatura}", acessível por teclado.

Estados da página: carregando `role="status"` "Carregando auditoria…"; 404 → `<h1>` "Lote não encontrado", o texto de `NAO_ENCONTRADO` e o link "Voltar à vitrine" para `/`; falha (`INDISPONIVEL`, rede, `MUITAS_TENTATIVAS`) → a mensagem do código e o botão "Tentar de novo". Lote ao vivo ou sem lances usa os mesmos textos (lote sem lances e sem selo é íntegro).

## Comprovante (`/comprovantes/:codigo`)
Tela pública, compartilhável (specs/011). `<h1>` e `<title>` "Comprovante de arremate" (`<title>` com o sufixo). Dados de `GET /api/comprovantes/{codigo}`. Nunca mostra nome nem e-mail.
- Imagem montada a partir do `snapshotId` de `carta.imagemUrl` (só `/api/imagens/{snapshotId}`, regra de §Comportamento "Links e imagens que vêm da API"), `alt="Carta {carta.nome}"`, `object-fit: contain`.
- `<dl>`: "Carta" (nome), "Valor do arremate", "Arrematado por" (pseudônimo), "Selado em" e "Emitido em" (data e hora), "Hash final", "Assinatura do selo" e "Chave de assinatura" (`keyId`).
- Link "Ver auditoria" para `/auditoria/{loteId}`, montado pela SPA a partir do `loteId` de `auditoriaUrl` (§Comportamento "Links e imagens que vêm da API").
- Botão "Copiar link" copia a URL completa do comprovante, montada como `window.location.origin` + `/comprovantes/` + `encodeURIComponent(codigo)` (nunca de um valor que o servidor mande; `navigator.clipboard`); sucesso → `role="status"` "Link copiado."; área de transferência indisponível ou recusada → um campo somente leitura rotulado "Link do comprovante", com a URL já selecionada, e o texto "Não foi possível copiar automaticamente. Copie o link abaixo."
- Carregando: `role="status"` "Carregando comprovante…". 404, a mesma tela para código inexistente e malformado: `<h1>` "Comprovante não encontrado", o texto "Confira o link: o código do comprovante não existe ou está incorreto." e o link "Voltar à vitrine" para `/`. Falha (`INDISPONIVEL`, rede, `MUITAS_TENTATIVAS`): a mensagem do código e o botão "Tentar de novo".

## Meus arremates (`/meus-arremates`)
Rota restrita a licitante (§Sessão e acesso). `<h1>` e `<title>` "Meus arremates" (com o sufixo). Duas abas (`role="tablist"`, cada uma `role="tab"` com `aria-selected`): "Meus lances" (padrão) e "Arrematados". Estado na URL: `aba` (`arrematados`; a aba padrão não aparece) e `pagina` (padrão 1 não aparece); trocar de aba volta `pagina` para 1; valores inválidos são ignorados. 24 itens por página nas duas, com a paginação de §Vitrine (`<nav aria-label="Paginação">`).
- **Aba "Meus lances"** (`GET /api/me/lances`): `<ul>` em `role="tabpanel"`. Cada `<li>`: imagem do lote (`alt="Carta {cartaNome}"`, só `/api/imagens/{snapshotId}`), título em `<h2>` que é o link para `/lotes/{id}`, o rótulo da posição e "Seu maior lance: {valor}". Rótulos, sempre com ícone **e** texto (nunca só cor):
  - `ganhando`: ícone de check, "Você está ganhando";
  - `superado`: ícone de alerta, "Você foi superado";
  - `venceu`: ícone de troféu, "Você venceu";
  - `perdeu`: ícone de "x", "Você não venceu".
- **Aba "Arrematados"** (`GET /api/me/arremates`): `<ul>` em `role="tabpanel"`. Cada `<li>`: imagem (`alt="Carta {carta.nome}"`), `<h2>` com o nome da carta, "Valor do arremate: {valor}", "Emitido em {data e hora}" e os links "Ver comprovante" (para `/comprovantes/{codigo}`, com `encodeURIComponent(codigo)`) e "Ver auditoria" (para `/auditoria/{loteId}`, montado a partir do `loteId` de `auditoriaUrl`); a imagem usa o `snapshotId` de `carta.imagemUrl`, tudo como em §Comportamento "Links e imagens que vêm da API".
- Estados: carregando `role="status"` "Carregando seus lances…" (aba "Meus lances") ou "Carregando seus arremates…" (aba "Arrematados"); vazio "Você ainda não deu nenhum lance." e "Você ainda não arrematou nenhum lote."; falha: a mensagem do código e o botão "Tentar de novo". Ao trocar de página, a lista anterior continua visível com `aria-busy="true"` (sem piscar) e o foco é preservado.

## Rodapé
Presente em todas as rotas (dentro do layout), com dois parágrafos de texto fixo:
1. Aviso da Fan Content Policy da Wizards of the Coast, no texto oficial em pt-BR do item 2 ("Informe a comunidade que ele não é oficial") de `https://company.wizards.com/pt-br/legal/fancontentpolicy` (verificado em 2026-10-24), com o título do conteúdo preenchido:
   > Casa de Leilões é um conteúdo de fã não oficial permitido sob a política de conteúdo de fãs. Não aprovado/apoiado pela Wizards. Porções do material usado são propriedade da Wizards of the Coast. ©Wizards of the Coast LLC.

   O trecho "política de conteúdo de fãs" é um link para `https://company.wizards.com/pt-br/legal/fancontentpolicy` (a política não exige o link; ele é mantido como referência).
2. Crédito à Scryfall:
   > Dados e imagens das cartas: Scryfall.

   "Scryfall" é um link para `https://scryfall.com`. Sem logo da Scryfall e sem frase que sugira endosso (regras da Scryfall, specs/005).

## Critérios de aceite
- [ ] axe-core sem violações sérias nas rotas acima, nos dois temas (Playwright).
- [ ] Cada código de recusa exibe a mensagem correspondente (e2e).
- [ ] Vitrine sem lotes cancelados.
- [ ] Teste de componente: uma rota inexistente (ex.: `/nao-existe`) renderiza, dentro do layout, o `<h1>` "Página não encontrada" e o link "Voltar à vitrine" com `href="/"`.
- [ ] Teste de componente: o rodapé contém exatamente os dois textos de §Rodapé, com os `href` `https://company.wizards.com/pt-br/legal/fancontentpolicy` e `https://scryfall.com`.
- [ ] Teste de componente (sessão): no carregamento, `me` com 200 mostra o nome e "Sair"; `me` 401 com refresh 401 deixa o usuário anônimo, sem nenhuma mensagem de sessão.
- [ ] Teste de componente (refresh único): 3 requisições simultâneas com 401 `NAO_AUTENTICADO` geram exatamente 1 chamada a `POST /api/auth/refresh` e cada requisição original é repetida exatamente 1 vez; se a repetição devolver 401, não há segundo refresh e aparece "Entre para continuar.".
- [ ] Teste de componente (sessão expirada): refresh em 401 durante o uso mostra "Sua sessão expirou. Entre novamente." e navega para `/entrar?retorno=%2Fcarteira` quando o usuário estava em `/carteira`.
- [ ] Teste de componente (acesso): anônimo em `/carteira` e em `/painel` → `/entrar?retorno=...` sem mensagem; leiloeiro em `/carteira` e licitante em `/painel/lotes/novo` → `<h1>` "Acesso não permitido", a mensagem de `PAPEL_NAO_PERMITIDO` e o link "Voltar à vitrine" com `href="/"`, dentro do layout; licitante logado em `/entrar` e em `/cadastro` → `/`, e leiloeiro → `/painel`.
- [ ] Teste de componente (retorno): depois do login, `retorno=/carteira` leva a `/carteira` para licitante; `retorno=//exemplo.com`, `retorno=/\exemplo.com`, `retorno=/carteira\x`, `retorno=https://exemplo.com` e `retorno=/painel` (licitante) levam a `/`; `retorno=/painel` leva a `/painel` para leiloeiro, e `retorno=/carteira` (leiloeiro) leva a `/painel`.
- [ ] Teste de componente (contas de demonstração): `/entrar` mostra, depois do link "Criar conta", a região "Contas de demonstração" com os três e-mails do seed, os papéis e a senha `leilao-demo-2026`.
- [ ] Teste de componente (cabeçalho): os itens de cada papel são exatamente os de §Sessão e acesso (anônimo: "Entrar" e "Criar conta"; licitante: "Carteira", "Meus arremates", nome e "Sair"; leiloeiro: "Painel", nome e "Sair").
- [ ] Teste de componente (mensagens): cada código e cada mensagem por campo das listas de §Comportamento aparece com o texto exato; `INDISPONIVEL` e uma falha de rede (fetch rejeitado) mostram o mesmo texto; depósito de R$ 50,00 mostra "Depósito de R$ 50,00 registrado."; valores R$ 0,99 e R$ 100.000,01 mostram "Informe um valor entre R$ 1,00 e R$ 100.000,00." e não enviam a requisição.
- [ ] Teste de componente (extrato): cada um dos 6 tipos mostra o rótulo de §Comportamento.
- [ ] Teste de unidade e de componente (sinal do extrato): cada um dos 6 tipos mostra o sinal de §Comportamento antes do valor (ex.: "+ R$ 50,00" no depósito, "− R$ 50,00" no compromisso).
- [ ] Testes de estilo: os tokens de §Identidade visual existem nos dois temas e passam no contraste AA; nenhuma tela usa cor fora dos tokens.
- [ ] Teste de componente (estado de erro): uma rota que lança `new Error("segredo interno")` mostra, dentro do layout, `<h1>` "Algo deu errado", o parágrafo e o link "Voltar à vitrine" com `href="/"` num `role="alert"`, sem o texto "segredo interno"; quando o layout lança, a tela tem `<main id="conteudo">` e o rodapé, sem o cabeçalho.
- [ ] Teste de componente: navegar para outro `pathname` coloca o foco no `<main id="conteudo">`; a primeira carga e uma navegação que só muda a query string não mudam o foco.
- [ ] Teste de componente (vitrine, estado na URL): `/?status=encerrado&q=dragao&raridade=rare&precoMin=500&precoMax=9900&ordem=maior_lance&pagina=2` marca a aba "Encerrados", preenche os controles (preços "5,00" e "99,00") e consulta `GET /api/lotes` com exatamente esses parâmetros; mudar a aba, o filtro ou a ordenação volta `pagina` para 1 e tira da URL os valores padrão; `?status=xyz&pagina=0&ordem=abc` equivale à URL sem parâmetros; `pagina` acima da última troca a URL para a última sem nova entrada de histórico.
- [ ] Teste de componente (vitrine, textos): cada item mostra imagem com `alt`, título como link para `/lotes/{id}`, raridade, a linha de preço certa para cada caso ("Lance inicial", "Lance atual", "Arrematado por", "Encerrado sem lances"), "Nenhum lance"/"1 lance"/"{n} lances" e a linha de horário de cada aba; os três vazios sem filtro, o vazio com filtro e o botão "Limpar filtros", "Carregando lotes…", a falha com "Tentar de novo" e o total ("1 lote encontrado", "{n} lotes encontrados") têm os textos exatos; preço máximo menor que o mínimo mostra "O preço máximo deve ser maior ou igual ao mínimo." e não envia.
- [ ] Teste de componente (paginação): com `total` 49 e `limite` 24 aparecem "Página 1 de 3", "Anterior" com `aria-disabled="true"` e "Próxima" ativo; com `total` 24 a paginação não aparece. Na busca do novo lote, `total` 26 e `limite` 25 dão "Página 1 de 2".
- [ ] Teste de componente (detalhe, F2; a sala da F3 o substitui e inclui o formulário): lote ao vivo com `suaPosicao` `ganhando` mostra "Você está ganhando este lote."; `venceu` mostra "Você venceu este lote."; `null` não mostra nenhuma das duas; lote `cancelado` mostra "Este lote foi cancelado."; 404 mostra `<h1>` "Lote não encontrado" e o link "Voltar à vitrine"; "Fim original" só aparece com `fimOriginalEm` diferente de `fimEm`; não existe campo nem botão de lance.
- [ ] Teste de componente (painel): mostra o resumo ("Total recebido", "Lotes arrematados", "Lotes sem lance") e a tabela "Meus lotes" com as colunas (inclusive "Ações") e os resultados "Arrematado por {valor}", "Sem arremate" e "—"; vazio "Você ainda não criou lotes."; depois de criar um lote aparece "Lote criado." e some ao recarregar.
- [ ] Teste de componente (novo lote, busca): `q` vazio e `q` de 201 caracteres mostram "Digite de 1 a 200 caracteres." e não enviam; resultados mostram miniatura com `referrerpolicy="no-referrer"`, "{colecao} · {raridade}" e "Escolher esta carta"; vazio "Nenhuma carta encontrada para esta busca."; 422 em `q` mostra "A Scryfall não entendeu esta busca. Confira a sintaxe.".
- [ ] Teste de componente (novo lote, formulário): cada mensagem por campo aparece com o texto exato (lance R$ 0,99 e R$ 1.000.000,01; início 61 s no passado; fim 4 min 59 s depois do início; duração de 7 dias + 1 min; datas vazias) e não envia; com "Começar agora" marcada o `inicioEm` enviado é o instante do envio; o botão fica "Criando…" e desabilitado durante o envio, de modo que um segundo clique não gera segunda requisição; 201 leva a `/painel` com "Lote criado."; 422 com `detalhes.campo` `scryfallId` mostra "Não foi possível usar esta carta. Escolha outra." e volta ao passo 1; 422 de outro campo mostra "Confira os campos destacados.".
- [ ] Teste de componente (mensagens do catálogo): `CATALOGO_OCUPADO` com `tenteNovamenteEm` 1 mostra "A busca de cartas está ocupada. Tente de novo em 1 s." e `CATALOGO_INDISPONIVEL` com 30 mostra "A busca de cartas está indisponível agora. Tente de novo em 30 s."; sem `detalhes`, vale o `Retry-After`.
- [ ] Teste de componente (ADR 0029): as miniaturas da busca do novo lote são as únicas imagens com origem em `cards.scryfall.io` e têm `referrerpolicy="no-referrer"` e `alt` com o nome da carta; em vitrine, detalhe do lote, sala, auditoria, comprovante e na lista do painel, todo `<img>` aponta para `/api/imagens/{snapshotId}`; a navegação entre o painel e as demais rotas usa o roteador, sem carregamento completo do documento.
- [ ] axe-core sem violações sérias na vitrine, no detalhe, no painel e no novo lote (passos 1 e 2), nos dois temas.
- [ ] Teste de componente (sala, estados): carregando, 404, falha com "Tentar de novo", `SALA_CHEIA`, sem lances, ganhando, superado, encerrada (com e sem arremate, `venceu` e `perdeu`), cancelada e agendada mostram os textos exatos de §Sala ao vivo; "Reconectando…" aparece com a conexão caída e desabilita o formulário.
- [ ] Teste de componente (sala, tempo): com relógio simulado e `agoraServidor` diferente do relógio local, a contagem usa o relógio do servidor; chega a "Encerrando…" sem tempo negativo; `fim_estendido` mostra o selo "Fim estendido" com ícone e texto e anuncia o novo fim; a posição muda de `sem_lance` a `ganhando` e de `ganhando` a `superado` pelos eventos.
- [ ] Teste de componente (sala, extensão vista no resync): um resync com `fimEm` maior que o local mostra o selo "Fim estendido" e anuncia o novo fim exatamente uma vez; um resync com `fimEm` igual mantém o aviso que estava na tela; a entrada inicial na sala não anuncia.
- [ ] Teste de componente (sala, anúncios): lance de outro licitante vai à região `polite`; "Você foi superado…" vai à região `assertive`; o próprio lance aceito não vai à `assertive`; o histórico mantém 50 itens, mais recente primeiro, com "(você)" no próprio.
- [ ] Teste de componente (formulário de lance): visível só para licitante com lote ao vivo; leiloeiro vê "Leiloeiros não podem dar lances." e anônimo vê "Entre como licitante para dar lances." com o link "Entrar"; o campo nasce com o mínimo; valor mal formado mostra "Informe um valor em reais, como 150,00." e não envia; "Dar lance mínimo ({valor})" envia o mínimo; o valor vai em centavos inteiros (R$ 150,05 → 15005).
- [ ] Teste de componente (recusas na sala): cada um dos 6 códigos da API mais `MUITAS_TENTATIVAS` mostra a mensagem de §Comportamento (`LANCE_ABAIXO_DO_MINIMO` com o mínimo e o campo preenchido com ele; `SALDO_INSUFICIENTE` com o disponível e o link "Ir para a carteira"; `MUITAS_TENTATIVAS` com os segundos de `Retry-After`).
- [ ] Teste de componente (duplo submit e chave): dois submits no mesmo tick geram uma única requisição; o reenvio da mesma tentativa depois de uma falha de rede reusa a `Idempotency-Key`; uma tentativa nova depois de uma resposta definitiva usa chave nova.
- [ ] Teste de componente (vitrine ao vivo): um `lance_aceito` atualiza o card sem recarregar nem mudar o foco; `lote_encerrado` refaz a consulta; sair da vitrine sai do room e remove os listeners.
- [ ] axe-core sem violações sérias na sala, nos dois temas, com lance, ganhando e superado (e2e).
- [ ] Teste de componente (painel, ações): a coluna "Ações" mostra "Cancelar lote" só para `agendado` e `ao_vivo` e o link "Auditoria" só para `encerrado` e `cancelado`.
- [ ] Teste de componente (cancelar lote): "Cancelar lote" abre o diálogo com o título e o texto exatos de §Cancelar lote e o foco em "Manter lote"; "Confirmar cancelamento" chama `POST /api/painel/lotes/{id}/cancelamento` exatamente uma vez, mesmo com dois cliques no mesmo tick, e mostra "Cancelando…" durante o envio; "Manter lote" e Esc fecham sem chamar a API e devolvem o foco ao botão de origem; o foco fica preso no diálogo; 200 mostra "Lote cancelado. Se havia líder, o valor reservado foi estornado." e refaz a lista e o resumo; 409 mostra "Não foi possível cancelar: o lote já foi encerrado ou cancelado."; 404 mostra "Não encontramos este lote. A lista foi atualizada."
- [ ] Teste de componente (auditoria): lote íntegro e lote adulterado mostram o veredito do servidor com ícone e texto e, no adulterado, "lance #4: hash não confere" com o `seq` certo (e "selo: …" nos problemas do selo); lote sem lances mostra "Nenhum lance foi registrado neste lote."; sem selo mostra o aviso de §Auditoria; 404 mostra `<h1>` "Lote não encontrado"; falha mostra "Tentar de novo"; carregando mostra "Carregando auditoria…".
- [ ] Teste de componente (verificação no navegador): "Verificar no meu navegador" mostra "Verificando…" e depois o resultado na região `aria-live="polite"`; veredito igual ao do servidor mostra "O resultado do seu navegador é igual ao do servidor."; veredito ou lista de problemas diferente mostra o `role="alert"` "Atenção: o resultado do seu navegador é diferente do resultado do servidor."; sem `crypto.subtle` mostra "Seu navegador não permite a verificação nesta página. Abra o site por uma conexão segura (HTTPS) e tente de novo." e nenhum veredito; um `keyId` ausente refaz a consulta de chaves exatamente uma vez.
- [ ] Teste de componente (limitação da verificação): depois de qualquer resultado da verificação no navegador, a região mostra o parágrafo "Chave pública usada na verificação: {keyId}. O servidor publica esta chave; para ter certeza de que é a verdadeira, compare este código com o publicado fora do servidor (README do projeto e página da versão)." com o `keyId` (ou os `keyId`, separados por ", ") das chaves usadas.
- [ ] Teste de componente (links e imagens da API): `auditoriaUrl` e `imagemUrl` que casam com o formato viram `href` e `src` montados pela SPA (`/auditoria/{loteId}` e `/api/imagens/{snapshotId}`); valores com outro formato (por exemplo `javascript:…`, `//outro.site/x`, `/auditoria/../x`) não viram link nem imagem ("Ver auditoria" ausente, "Sem imagem"); "Copiar link" copia `window.location.origin` + `/comprovantes/` + o código com `encodeURIComponent`, e um `:codigo` com caracteres especiais não escapa da URL.
- [ ] Teste de componente (comprovante): mostra todos os campos de §Comprovante, com `<img>` apontando para `/api/imagens/…`; "Copiar link" mostra "Link copiado." e, com a área de transferência recusada, o campo "Link do comprovante" e o texto de fallback; o 404 é a mesma tela para código inexistente e malformado ("Comprovante não encontrado"); carregando e falha têm os textos exatos; nenhum nome nem e-mail na tela.
- [ ] Teste de componente (meus arremates): cada uma das quatro posições mostra o rótulo e o ícone de §Meus arremates; as duas abas mostram os textos exatos e os links "Ver comprovante" e "Ver auditoria"; `aba` e `pagina` na URL reconstroem a tela e trocar de aba volta `pagina` para 1; os dois vazios, o carregando de cada aba e a falha com "Tentar de novo" têm os textos exatos; anônimo é levado a `/entrar?retorno=%2Fmeus-arremates` e leiloeiro vê "Acesso não permitido".
- [ ] Teste de componente (sala, encerramento): os estados encerrada e cancelada mostram o link "Ver auditoria" com `href` `/auditoria/{id}`.
- [ ] axe-core sem violações sérias na auditoria (íntegra e adulterada), no comprovante, em "Meus arremates" (as duas abas) e no painel com o diálogo aberto, nos dois temas (jsdom e Playwright).

## Decisões relacionadas
- decisions/0006-autenticacao-jwt-cookies.md, 0011-stack-backend-frontend.md, 0022-complementos-auth-e-idempotencia.md, 0029-miniaturas-da-busca-no-painel.md, 0031-complementos-da-f3.md, 0032-complementos-da-f4.md
