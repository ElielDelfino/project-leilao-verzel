// Conexão com o Redis lida em partes (specs/014 §"Conexão da API com Postgres e Redis"):
// REDIS_HOST, REDIS_PORT e REDIS_PASSWORD (ou REDIS_PASSWORD_FILE), validadas em
// config/env.ts. Não há REDIS_URL: uma URL duplicaria a senha.

/**
 * Parâmetros do cliente Redis. `password` é não enumerável: não aparece em JSON.stringify,
 * Object.keys, spread nem util.inspect (mesmo critério de ConexaoDoBanco, db/conexao.ts).
 */
export interface ConexaoDoRedis {
  readonly host: string;
  readonly port: number;
  readonly password: string;
}

export function criarConexaoDoRedis(
  partes: Omit<ConexaoDoRedis, 'password'>,
  password: string,
): ConexaoDoRedis {
  const conexao = { host: partes.host, port: partes.port };
  Object.defineProperty(conexao, 'password', { value: password, enumerable: false });
  return Object.freeze(conexao) as ConexaoDoRedis;
}
