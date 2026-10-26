---
description: Convenções da SPA React (carrega ao editar apps/web)
paths:
  - "apps/web/**"
---

# Web (apps/web)

- **Stack.** React 19, Vite, React Query v5 para estado do servidor e Tailwind 4 com tokens. Os tipos da API vêm de `@leilao/contracts`; não redeclare formato de resposta.
- **Tokens e temas.** Cores só pelos tokens, nos dois temas. `test/estilos/tokens-usados.test.ts` e `test/estilos/contraste.test.ts` recusam token inexistente e par abaixo de AA; rode-os ao mexer em estilo.
- **Telas públicas.** Vitrine, sala, auditoria e comprovante leem só a API do projeto e nunca chamam a Scryfall. Nada mostra nome ou e-mail de licitante: só o pseudônimo.
- **Dinheiro.** Valores chegam e saem em centavos inteiros; a formatação para real acontece só na exibição.
- **Mensagens.** Texto de tela e de erro em pt-BR, no catálogo de `src/mensagens/` (lista em specs/012 §Comportamento).
- **Testes.** Vitest + Testing Library, com MSW sobre o contrato nas telas que chamam a API. Acessibilidade (axe) e e2e ficam em `e2e/`.
- Rotas e comportamento de cada tela: specs/012.
