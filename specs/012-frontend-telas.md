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
- Imagens das cartas conforme as regras da Scryfall (specs/005); rodapé com aviso da Fan Content Policy.

## Critérios de aceite
- [ ] axe-core sem violações sérias nas rotas acima, nos dois temas (Playwright).
- [ ] Cada código de recusa exibe a mensagem correspondente (e2e).
- [ ] Vitrine sem lotes cancelados.

## Decisões relacionadas
- decisions/0011-stack-backend-frontend.md
