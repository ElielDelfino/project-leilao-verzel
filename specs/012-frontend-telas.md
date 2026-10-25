# 012 — Frontend: telas

Status: aprovada
Depende de: 003 a 011

## Rotas
| Rota | Acesso | Conteúdo |
|---|---|---|
| `/` | público | vitrine com abas Ao vivo / Agendados / Encerrados, busca, filtros, ordenação, paginação (estado na URL) |
| `/lotes/:id` | público (lance exige licitante) | sala ao vivo |
| `/entrar`, `/cadastro` | anônimo | login e cadastro com escolha de papel |
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
  - `SESSAO_EXPIRADA`: "Sua sessão expirou. Entre novamente." (leva a `/entrar`)
  - `MUITAS_TENTATIVAS`: "Muitas tentativas. Tente de novo em {segundos} s." (`{segundos}` vem do header `Retry-After`)
- Sala: botão de lance rápido com o valor mínimo pré-preenchido; indicador "Você está ganhando" / "Você foi superado" com cor **e** ícone **e** texto (não só cor); contagem regressiva corrigida pelo relógio do servidor; destaque visual quando o fim é estendido.
- Dinheiro sempre por `Intl.NumberFormat('pt-BR', {style: 'currency', currency: 'BRL'})`; datas em `America/Sao_Paulo`.
- Dark mode: tokens CSS em `:root` e `[data-theme="dark"]`; segue `prefers-color-scheme` por padrão; alternância salva no `localStorage`.
- Acessibilidade (WCAG 2.2 AA): navegação por teclado, foco visível, `aria-live="polite"` para novos lances e `assertive` para "superado", contraste AA nos dois temas, alvos ≥ 24×24 px, `prefers-reduced-motion` respeitado.
- Foco ao trocar de rota: quando o `pathname` muda, o foco vai para o `<main id="conteudo" tabindex="-1">` (o link "Pular para o conteúdo" aponta para ele). O foco **não** é movido na primeira carga nem quando só mudam a query string ou o hash.
- Imagens das cartas conforme as regras da Scryfall (specs/005); rodapé conforme §Rodapé.

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
- [ ] Teste de componente: navegar para outro `pathname` coloca o foco no `<main id="conteudo">`; a primeira carga e uma navegação que só muda a query string não mudam o foco.

## Decisões relacionadas
- decisions/0011-stack-backend-frontend.md
