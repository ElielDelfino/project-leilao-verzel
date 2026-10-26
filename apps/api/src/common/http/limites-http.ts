// Limites HTTP explícitos da API (tarefa 020). Valem para o servidor do Node que o Fastify cria;
// em produção o Caddy está na frente (infra/caddy/Caddyfile: corpo de até 1 MB, cabeçalhos em até
// 10 s, keep-alive do proxy para a API de 2 min, o padrão do transporte http do reverse_proxy).

/** Teto do corpo JSON: 1 MiB, o padrão do Fastify, agora declarado (a borda já corta em 1 MB). */
export const LIMITE_DO_CORPO_BYTES = 1_048_576;

export interface TimeoutsHttp {
  /** `server.keepAliveTimeout`: maior que o keepalive de 2 min do Caddy, para ele nunca reusar
   * uma conexão que a API acabou de fechar (o Caddy responderia 502 a um POST). */
  readonly keepAliveMs: number;
  /** `server.requestTimeout`: receber a requisição inteira (cabeçalhos e corpo). */
  readonly requisicaoMs: number;
  /** `server.headersTimeout`: receber os cabeçalhos (slowloris); igual ao `read_header` do Caddy. */
  readonly cabecalhosMs: number;
  /** `server.setTimeout` (o `connectionTimeout` do Fastify): socket sem tráfego. Acima dos ~25 s
   * que a auditoria pode levar (specs/011) e do ping de 25 s do Socket.IO; o WebSocket já
   * promovido não é afetado (o `ws` zera o timeout do socket). */
  readonly conexaoOciosaMs: number;
}

export const TIMEOUTS_HTTP: TimeoutsHttp = Object.freeze({
  keepAliveMs: 125_000,
  requisicaoMs: 30_000,
  cabecalhosMs: 10_000,
  conexaoOciosaMs: 60_000,
});
