// Catálogo de códigos de erro (specs/001 §Contratos). Espelha o enum de
// components.schemas.Erro em apps/api/openapi.yaml; o teste test/common/erros/codigos.test.ts
// falha se os dois divergirem. Código novo entra primeiro no openapi.yaml (spec-guardian).
export const CODIGOS_DE_ERRO = [
  'DADOS_INVALIDOS',
  'NAO_AUTENTICADO',
  'CSRF_INVALIDO',
  'NAO_ENCONTRADO',
  'MUITAS_TENTATIVAS',
  'CREDENCIAIS_INVALIDAS',
  'EMAIL_EM_USO',
  'SESSAO_EXPIRADA',
  'SALDO_INSUFICIENTE',
  'LANCE_ABAIXO_DO_MINIMO',
  'JA_ESTA_GANHANDO',
  'LOTE_NAO_INICIADO',
  'LOTE_ENCERRADO',
  'LEILOEIRO_NAO_PODE_LANCAR',
  'CATALOGO_INDISPONIVEL',
  'CATALOGO_OCUPADO',
  'INDISPONIVEL',
] as const;

export type CodigoDeErro = (typeof CODIGOS_DE_ERRO)[number];
