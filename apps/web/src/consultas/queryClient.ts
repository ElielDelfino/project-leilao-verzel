import { QueryClient } from '@tanstack/react-query';

// Estado do servidor fica no cache do TanStack Query (specs/012 §Comportamento); o tempo real
// atualiza esse cache com setQueryData. Defaults da biblioteca até haver motivo para mudar.
export function criarQueryClient(): QueryClient {
  return new QueryClient();
}
