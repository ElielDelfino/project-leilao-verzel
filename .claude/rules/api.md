---
description: Convenções da API NestJS (carrega ao editar apps/api ou packages/contracts)
paths:
  - "apps/api/**"
  - "packages/contracts/**"
---

# API (apps/api)

- **Módulos.** Cada módulo vive em `apps/api/src/modules/<nome>/` e expõe só o seu `index.ts`. O ESLint recusa import de outro módulo que não passe por ele (arestas em specs/001). Para participar da mesma transação, receba o `tx` por parâmetro.
- **Resposta.** Sempre o envelope de `src/common/envelope.ts`: `{ sucesso: true, dados }` ou `{ sucesso: false, erro: { codigo, mensagem, detalhes? } }`. Os códigos saem de `src/common/erros/codigos.ts`. Erro do cliente é 4xx com mensagem fixa e sem stack; 5xx só para falha do servidor.
- **Entrada.** Valide com Zod (`src/common/validacao/pipe-zod.ts`) na borda do controller.
- **Contrato.** O `apps/api/openapi.yaml` e os `src/**/schema.ts` não são do api-dev: a mudança entra como tarefa para o spec-guardian ou o db-dev. `packages/contracts` só se regenera (`pnpm contracts:gen`).
- **Testes.** Unidade ao lado do módulo; integração em `apps/api/test/`, com o banco clonado do template (`LEILAO_TEST_DB=local`). Rode um arquivo com `pnpm verify:quick -- <arquivo> -t "<nome>"`.
- **Erros do banco.** Falha de conexão vira `ErroDoBanco`; o detalhe do SQL nunca vai ao cliente.
- As invariantes de dinheiro, lance, integridade e segredos estão no `AGENTS.md`.
