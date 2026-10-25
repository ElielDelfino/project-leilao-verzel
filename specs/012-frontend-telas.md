# 012 — Frontend: telas

Status: aprovada
Depende de: 003 a 011

## Rotas
| Rota | Acesso | Conteúdo |
|---|---|---|
| `/` | público | vitrine com abas Ao vivo / Agendados / Encerrados, busca, filtros, ordenação, paginação (estado na URL) |
| `/lotes/:id` | público (lance exige licitante) | sala ao vivo |
| `/entrar`, `/cadastro` | anônimo (logado vai ao destino padrão, §Sessão e acesso) | login e cadastro com escolha de papel |
| `/carteira` | licitante | total, comprometido, disponível, depósito, extrato |
| `/meus-arremates` | licitante | abas "Meus lances" e "Arrematados" |
| `/painel` | leiloeiro | resumo (total recebido), lista dos lotes, resultados |
| `/painel/lotes/novo` | leiloeiro | busca na Scryfall → formulário do lote |
| `/auditoria/:loteId` | público | auditoria com verificação no navegador |
| `/comprovantes/:codigo` | público | comprovante compartilhável |
| `*` (qualquer outra) | público | página 404 dentro do layout: `<h1>` e `<title>` "Página não encontrada" (`<title>` com o sufixo " · Casa de Leilões"), link "Voltar à vitrine" para `/`; sem redirecionamento automático |

Rota inexistente: o Caddy devolve o `index.html` com HTTP 200 (fallback da SPA) e a página 404 é decidida pelo React Router. Fora da SPA não há fallback: `/api/*` desconhecido → 404 `NAO_ENCONTRADO` (specs/001 §Erros); `/assets/*` ausente → 404 do Caddy.

## Comportamento
- Estado do servidor com TanStack Query; o tempo real atualiza o cache da query (`setQueryData`) a partir dos eventos.
- Lance **não otimista**: o botão fica em "enviando…" e mostra o resultado do servidor. As recusas mapeiam código → mensagem pt-BR:
  - `LANCE_ABAIXO_DO_MINIMO`: "Seu lance precisa ser de pelo menos {minimo}."
  - `SALDO_INSUFICIENTE`: "Saldo disponível insuficiente: você tem {disponivel}."
  - `JA_ESTA_GANHANDO`: "Você já está ganhando este lote."
  - `LOTE_NAO_INICIADO`: "Este lote ainda não começou. Abre em {inicio}."
  - `LOTE_ENCERRADO`: "Este lote já foi encerrado."
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
- Sala: botão de lance rápido com o valor mínimo pré-preenchido; indicador "Você está ganhando" / "Você foi superado" com cor **e** ícone **e** texto (não só cor); contagem regressiva corrigida pelo relógio do servidor; destaque visual quando o fim é estendido.
- Dinheiro sempre por `Intl.NumberFormat('pt-BR', {style: 'currency', currency: 'BRL'})`; datas em `America/Sao_Paulo`.
- Dark mode: tokens CSS em `:root` e `[data-theme="dark"]`; segue `prefers-color-scheme` por padrão; alternância salva no `localStorage`.
- Acessibilidade (WCAG 2.2 AA): navegação por teclado, foco visível, `aria-live="polite"` para novos lances e `assertive` para "superado", contraste AA nos dois temas, alvos ≥ 24×24 px, `prefers-reduced-motion` respeitado.
- Foco ao trocar de rota: quando o `pathname` muda, o foco vai para o `<main id="conteudo" tabindex="-1">` (o link "Pular para o conteúdo" aponta para ele). O foco **não** é movido na primeira carga nem quando só mudam a query string ou o hash.
- Imagens das cartas conforme as regras da Scryfall (specs/005); rodapé conforme §Rodapé.
- Sessão, acesso por rota e cabeçalho: §Sessão e acesso. Falha inesperada de página: §Estado de erro.

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
- [ ] Teste de componente (cabeçalho): os itens de cada papel são exatamente os de §Sessão e acesso (anônimo: "Entrar" e "Criar conta"; licitante: "Carteira", "Meus arremates", nome e "Sair"; leiloeiro: "Painel", nome e "Sair").
- [ ] Teste de componente (mensagens): cada código e cada mensagem por campo das listas de §Comportamento aparece com o texto exato; `INDISPONIVEL` e uma falha de rede (fetch rejeitado) mostram o mesmo texto; depósito de R$ 50,00 mostra "Depósito de R$ 50,00 registrado."; valores R$ 0,99 e R$ 100.000,01 mostram "Informe um valor entre R$ 1,00 e R$ 100.000,00." e não enviam a requisição.
- [ ] Teste de componente (extrato): cada um dos 6 tipos mostra o rótulo de §Comportamento.
- [ ] Teste de componente (estado de erro): uma rota que lança `new Error("segredo interno")` mostra, dentro do layout, `<h1>` "Algo deu errado", o parágrafo e o link "Voltar à vitrine" com `href="/"` num `role="alert"`, sem o texto "segredo interno"; quando o layout lança, a tela tem `<main id="conteudo">` e o rodapé, sem o cabeçalho.
- [ ] Teste de componente: navegar para outro `pathname` coloca o foco no `<main id="conteudo">`; a primeira carga e uma navegação que só muda a query string não mudam o foco.

## Decisões relacionadas
- decisions/0006-autenticacao-jwt-cookies.md, 0011-stack-backend-frontend.md, 0022-complementos-auth-e-idempotencia.md
